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

#include "config.h"

#include "mock-auth.h"

#include "cockpitws.h"

#include "common/cockpitauthorize.h"
#include "common/cockpiterror.h"
#include "common/cockpitpipetransport.h"

#include "websocket/websocket.h"

#include <stdlib.h>
#include <string.h>

struct _MockAuth {
  CockpitAuth parent;
  gchar *expect_user;
  gchar *expect_password;
  JsonObject *failure_data;
};

typedef struct _CockpitAuthClass MockAuthClass;

G_DEFINE_TYPE (MockAuth, mock_auth, COCKPIT_TYPE_AUTH)

static void
mock_auth_init (MockAuth *self)
{
  self->failure_data = NULL;
}

static void
mock_auth_finalize (GObject *obj)
{
  MockAuth *self = MOCK_AUTH (obj);
  g_free (self->expect_user);
  g_free (self->expect_password);
  if (self->failure_data)
    json_object_unref (self->failure_data);
  G_OBJECT_CLASS (mock_auth_parent_class)->finalize (obj);
}

static void
mock_auth_login_async (CockpitAuth *auth,
                       const gchar *path,
                       GIOStream *connection,
                       GHashTable *headers,
                       GAsyncReadyCallback callback,
                       gpointer user_data)
{
  MockAuth *self = MOCK_AUTH (auth);
  GSimpleAsyncResult *result;
  gboolean correct = FALSE;
  const gchar *authorization;
  char *password = NULL;
  char *user = NULL;
  char *type = NULL;

  result = g_simple_async_result_new (G_OBJECT (auth), callback, user_data, NULL);

  g_object_set_data_full (G_OBJECT (result), "application",
                          cockpit_auth_parse_application (path, NULL),
                          g_free);

  authorization = g_hash_table_lookup (headers, "authorization");
  if (authorization)
    {
      if (cockpit_authorize_type (authorization, &type) && g_strcmp0 (type, "basic") == 0)
        {
          password = cockpit_authorize_parse_basic (authorization, &user);
          correct = g_strcmp0 (password, self->expect_password) == 0 &&
                    g_strcmp0 (user, self->expect_user) == 0;
          free (password);
          free (user);
        }
    }

  if (!correct)
    {
      g_simple_async_result_set_error (result, COCKPIT_ERROR,
                                       COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication failed");
    }

  g_simple_async_result_complete_in_idle (result);
  g_object_unref (result);
  free (type);
}

static CockpitCreds *
mock_auth_login_finish (CockpitAuth *auth,
                        GAsyncResult *async,
                        GIOStream *connection,
                        GHashTable *headers,
                        JsonObject **prompt_data,
                        CockpitTransport **transport,
                        GError **error)
{
  MockAuth *self = MOCK_AUTH (auth);
  GSimpleAsyncResult *result = G_SIMPLE_ASYNC_RESULT (async);
  CockpitCreds *creds;
  CockpitPipe *pipe;
  GBytes *bytes;
  gchar *nonce;

  const gchar *argv[] = {
    cockpit_ws_bridge_program ? cockpit_ws_bridge_program : BUILDDIR "/cockpit-bridge",
    NULL
  };

  if (g_simple_async_result_propagate_error (result, error))
    {
      if (prompt_data && self->failure_data)
        *prompt_data = json_object_ref (self->failure_data);
      return NULL;
    }

  nonce = cockpit_auth_nonce (auth);

  bytes = g_bytes_new_take (g_strdup (self->expect_password), strlen (self->expect_password));
  creds = cockpit_creds_new (g_object_get_data (G_OBJECT (result), "application"),
                             COCKPIT_CRED_USER, self->expect_user,
                             COCKPIT_CRED_PASSWORD, bytes,
                             COCKPIT_CRED_RHOST, g_object_get_data (G_OBJECT (result), "remote"),
                             COCKPIT_CRED_CSRF_TOKEN, nonce,
                             NULL);

  g_bytes_unref (bytes);
  g_free (nonce);

  if (transport)
    {
      pipe = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
      *transport = cockpit_pipe_transport_new (pipe);
      g_object_unref (pipe);
    }

  return creds;
}

static void
mock_auth_class_init (MockAuthClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  klass->login_async = mock_auth_login_async;
  klass->login_finish = mock_auth_login_finish;
  object_class->finalize = mock_auth_finalize;
}

CockpitAuth *
mock_auth_new (const char *expect_user,
               const char *expect_password)
{
  MockAuth *self;

  g_assert (expect_user != NULL);
  g_assert (expect_password != NULL);

  self = g_object_new (MOCK_TYPE_AUTH, NULL);
  self->expect_user = g_strdup (expect_user);
  self->expect_password = g_strdup (expect_password);

  return COCKPIT_AUTH (self);
}

void
mock_auth_set_failure_data (MockAuth *self,
                            JsonObject *data)
{
  g_assert (self->failure_data == NULL);
  self->failure_data = json_object_ref (data);
}

GHashTable *
mock_auth_basic_header (const gchar *user,
                        const gchar *password)
{
  GHashTable *headers;
  gchar *userpass;
  gchar *encoded;
  gchar *header;

  userpass = g_strdup_printf ("%s:%s", user, password);
  encoded = g_base64_encode ((guchar *)userpass, strlen (userpass));
  header = g_strdup_printf ("Basic %s", encoded);

  g_free (userpass);
  g_free (encoded);

  headers = web_socket_util_new_headers ();
  g_hash_table_insert (headers, g_strdup ("Authorization"), header);
  return headers;
}

void
mock_auth_include_cookie_as_if_client (GHashTable *resp_headers,
                                       GHashTable *req_headers,
                                       const gchar *cookie_name)
{
  gchar *cookie;
  gchar *end;
  gchar *expected = g_strdup_printf ("%s=", cookie_name);

  cookie = g_strdup (g_hash_table_lookup (resp_headers, "Set-Cookie"));
  g_assert (cookie != NULL);
  end = strchr (cookie, ';');
  g_assert (end != NULL);
  end[0] = '\0';

  g_assert (strncmp (cookie, expected, strlen(expected)) == 0);

  g_hash_table_insert (req_headers, g_strdup ("Cookie"), cookie);
  g_free (expected);
}
