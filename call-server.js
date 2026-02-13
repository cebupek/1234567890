/**
 * CUSTOM CALL RELAY SERVER
 * 
 * Весь медиа-трафик идёт через наш сервер по WebSocket.
 * Не зависит от Google STUN / TURN / любых внешних сервисов.
 * РКН не может заблокировать, т.к. это просто WebSocket-трафик
 * на том же домене что и мессенджер.
 */

module.exports = function initCallServer(io) {
  // roomId -> { callerId, callType, participants: Map<userId, socketId> }
  const callRooms = new Map();

  // userId -> socketId (локальный индекс для звонков)
  const callUserSockets = new Map();

  io.on('connection', (socket) => {

    // Регистрация пользователя в call-системе
    socket.on('call_register', (userId) => {
      callUserSockets.set(userId, socket.id);
    });

    // Создание комнаты звонка (инициатор)
    socket.on('call_create_room', ({ roomId, callerId, callType }) => {
      callRooms.set(roomId, {
        callerId,
        callType,
        participants: new Map([[callerId, socket.id]]),
        createdAt: Date.now()
      });
      socket.join('call_' + roomId);
      console.log(`[CALL] Комната создана: ${roomId}, тип: ${callType}`);
    });

    // Присоединение к комнате (получатель)
    socket.on('call_join_room', ({ roomId, userId }) => {
      const room = callRooms.get(roomId);
      if (!room) {
        socket.emit('call_error', { message: 'Комната не найдена' });
        return;
      }
      room.participants.set(userId, socket.id);
      socket.join('call_' + roomId);

      // Уведомляем всех участников
      io.to('call_' + roomId).emit('call_participant_joined', { userId, roomId });
      console.log(`[CALL] ${userId} присоединился к комнате ${roomId}`);
    });

    // Ретрансляция аудио-чанка
    socket.on('call_audio_chunk', ({ roomId, chunk, userId }) => {
      socket.to('call_' + roomId).emit('call_audio_chunk', {
        chunk,
        userId,
        ts: Date.now()
      });
    });

    // Ретрансляция видео-кадра (JPEG в base64)
    socket.on('call_video_frame', ({ roomId, frame, userId }) => {
      socket.to('call_' + roomId).emit('call_video_frame', {
        frame,
        userId
      });
    });

    // Сигнал готовности (после join)
    socket.on('call_ready', ({ roomId, userId }) => {
      socket.to('call_' + roomId).emit('call_peer_ready', { userId });
    });

    // Покинуть / завершить звонок
    socket.on('call_leave_room', ({ roomId, userId }) => {
      const room = callRooms.get(roomId);
      if (room) {
        room.participants.delete(userId);
        io.to('call_' + roomId).emit('call_participant_left', { userId });

        if (room.participants.size === 0) {
          callRooms.delete(roomId);
          console.log(`[CALL] Комната удалена: ${roomId}`);
        }
      }
      socket.leave('call_' + roomId);
    });

    // При дисконнекте — убираем из всех комнат
    socket.on('disconnect', () => {
      let disconnectedUserId = null;
      for (const [uid, sid] of callUserSockets.entries()) {
        if (sid === socket.id) {
          disconnectedUserId = uid;
          callUserSockets.delete(uid);
          break;
        }
      }

      if (disconnectedUserId) {
        for (const [roomId, room] of callRooms.entries()) {
          if (room.participants.has(disconnectedUserId)) {
            room.participants.delete(disconnectedUserId);
            io.to('call_' + roomId).emit('call_participant_left', {
              userId: disconnectedUserId
            });
            if (room.participants.size === 0) {
              callRooms.delete(roomId);
            }
          }
        }
      }
    });
  });

  console.log('[CALL SERVER] Кастомный сервер звонков инициализирован');
};
