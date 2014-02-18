/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef WEB_SOCKET_H_097E42E0D72541E497C099B377D9569F
#define WEB_SOCKET_H_097E42E0D72541E497C099B377D9569F

#include <gio/gio.h>

G_BEGIN_DECLS

#define WEB_SOCKET_ERROR        (web_socket_error_get_quark ())

GQuark          web_socket_error_get_quark     (void) G_GNUC_CONST;

GHashTable *    web_socket_util_new_headers    (void);

gssize          web_socket_util_parse_headers  (const gchar *data,
                                                gsize length,
                                                GHashTable **headers);

gsize           web_socket_util_parse_req_line (const gchar *data,
                                                gsize length,
                                                gchar **method,
                                                gchar **resource);

typedef enum {
  WEB_SOCKET_DATA_TEXT = 0x01,
  WEB_SOCKET_DATA_BINARY = 0x02,
} WebSocketDataType;

typedef enum {
  WEB_SOCKET_CLOSE_NORMAL = 1000,
  WEB_SOCKET_CLOSE_GOING_AWAY = 1001,
  WEB_SOCKET_CLOSE_NO_STATUS = 1005,
  WEB_SOCKET_CLOSE_ABNORMAL = 1006,
  WEB_SOCKET_CLOSE_PROTOCOL = 1002,
  WEB_SOCKET_CLOSE_UNSUPPORTED_DATA = 1003,
  WEB_SOCKET_CLOSE_BAD_DATA = 1007,
  WEB_SOCKET_CLOSE_POLICY_VIOLATION = 1008,
  WEB_SOCKET_CLOSE_TOO_BIG = 1009,
  WEB_SOCKET_CLOSE_NO_EXTENSION = 1010,
  WEB_SOCKET_CLOSE_SERVER_ERROR = 1011,
  WEB_SOCKET_CLOSE_TLS_HANDSHAKE = 1015,
} WebSocketCloseCodes;

typedef enum {
  WEB_SOCKET_STATE_CONNECTING = 0,
  WEB_SOCKET_STATE_OPEN = 1,
  WEB_SOCKET_STATE_CLOSING = 2,
  WEB_SOCKET_STATE_CLOSED = 3,
} WebSocketState;

/*
 * The WebSocket flavors we speak, the only reason we even attempt
 * this silliness is to remain compatible with iPads and so on
 *
 * Note this is different from protocols as in Sec-WebSocket-Protocol
 * which is a protocol spoken over the WebSocket (such as cockpit1, or xmpp)
 */
typedef enum {
  WEB_SOCKET_FLAVOR_UNKNOWN = 0,   /* No flavor decided yet */
  WEB_SOCKET_FLAVOR_RFC6455 = 13,  /* http://tools.ietf.org/html/rfc6455 */
  WEB_SOCKET_FLAVOR_HIXIE76 = 76,  /* http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-76 */
} WebSocketFlavor;

typedef struct WebSocketConnection       WebSocketConnection;
typedef struct WebSocketConnectionClass  WebSocketConnectionClass;
typedef struct WebSocketClient           WebSocketClient;
typedef struct WebSocketClientClass      WebSocketClientClass;
typedef struct WebSocketServer           WebSocketServer;
typedef struct WebSocketServerClass      WebSocketServerClass;

#include "websocketconnection.h"
#include "websocketclient.h"
#include "websocketserver.h"

G_END_DECLS

#endif /* __WEB_SOCKET_H__ */
