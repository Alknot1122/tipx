let _io = null;

/**
 * Initialize the WebSocket module with the Socket.io instance.
 * Called once during server startup.
 * @param {import('socket.io').Server} io
 */
const initWidgetSocket = (io) => {
  _io = io;

  // Namespace: /widget  (OBS browser sources connect here)
  const widgetNS = io.of('/widget');

  widgetNS.use(async (socket, next) => {
    // Authenticate by alert_token query param
    const token = socket.handshake.query.token;
    if (!token) {
      return next(new Error('Authentication error: missing token'));
    }

    // Lazy-load to avoid circular deps at startup
    const { query } = require('../config/db');

    try {
      const { rows } = await query(
        `SELECT ws.streamer_id
         FROM widget_settings ws
         WHERE ws.alert_token = $1`,
        [token]
      );

      if (!rows.length) {
        return next(new Error('Authentication error: invalid token'));
      }

      socket.streamerId = rows[0].streamer_id;
      next();
    } catch (err) {
      console.error('[WS] Auth middleware error:', err.message);
      next(new Error('Internal error'));
    }
  });

  widgetNS.on('connection', (socket) => {
    const room = `streamer:${socket.streamerId}`;
    socket.join(room);

    console.log(`[WS] Widget connected → room ${room} (socket ${socket.id})`);

    // Widget sends a 'ping' to keep the OBS browser source alive
    socket.on('ping', () => socket.emit('pong'));

    socket.on('disconnect', (reason) => {
      console.log(`[WS] Widget disconnected (socket ${socket.id}): ${reason}`);
    });
  });

  console.log('[WS] Widget socket initialized on namespace /widget');
};

/**
 * Returns the Socket.io server instance.
 * Used by controllers to emit events.
 */
const getIO = () => {
  if (!_io) throw new Error('Socket.io not initialized. Call initWidgetSocket first.');
  return _io.of('/widget');
};

module.exports = { initWidgetSocket, getIO };
