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

#include "cockpitwebserver.h"

#include "websocket/websocket.h"
#include "websocket/websocketprivate.h"

#include <string.h>

typedef struct {
    CockpitWebServer *web_server;
    gint port;
} TestCase;

static void
setup (TestCase *tc,
       gconstpointer data)
{
  const gchar *roots[] = { BUILDDIR, NULL };
  GError *error = NULL;
  tc->web_server = cockpit_web_server_new (0, NULL, roots, NULL, &error);
  g_assert_no_error (error);

  /* Automatically chosen by the web server */
  g_object_get (tc->web_server, "port", &tc->port, NULL);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  /* Verifies that we're not leaking the web server */
  g_object_add_weak_pointer (G_OBJECT (tc->web_server), (gpointer *)&tc->web_server);
  g_object_unref (tc->web_server);
  g_assert (tc->web_server == NULL);
}

static void
test_table (void)
{
  GHashTable *table;

  table = cockpit_web_server_new_table ();

  /* Case insensitive keys */
  g_hash_table_insert (table, g_strdup ("Blah"), g_strdup ("value"));
  g_hash_table_insert (table, g_strdup ("blah"), g_strdup ("another"));
  g_hash_table_insert (table, g_strdup ("Different"), g_strdup ("One"));

  g_assert_cmpstr (g_hash_table_lookup (table, "BLAH"), ==, "another");
  g_assert_cmpstr (g_hash_table_lookup (table, "differeNT"), ==, "One");

  g_hash_table_destroy (table);
}

static void
test_return_content (void)
{
  GOutputStream *out;
  const gchar *data;

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  cockpit_web_server_return_content (out, NULL, "the content", 11);

  /* Null terminate because g_assert_cmpstr() */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nthe content");

  g_object_unref (out);
}

static void
test_return_content_headers (void)
{
  GOutputStream *out;
  const gchar *data;
  GHashTable *headers;

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("My-header"), g_strdup ("my-value"));

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  cockpit_web_server_return_content (out, headers, "the content", 11);
  g_hash_table_destroy (headers);

  /* Null terminate because g_assert_cmpstr() */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==, "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\nMy-header: my-value\r\n\r\nthe content");

  g_object_unref (out);
}


static void
test_return_error (void)
{
  GOutputStream *out;
  const gchar *data;

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  cockpit_web_server_return_error (out, 500, NULL, "Reason here: %s", "booyah");

  /* Null terminate it for fun */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nContent-Length: 96\r\nConnection: close\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");

  g_object_unref (out);
}

static void
test_return_error_headers (void)
{
  GOutputStream *out;
  const gchar *data;
  GHashTable *headers;

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  headers = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_insert (headers, "Header1", "value1");

  cockpit_web_server_return_error (out, 500, headers, "Reason here: %s", "booyah");

  g_hash_table_destroy (headers);

  /* Null terminate it for fun */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nContent-Length: 96\r\nConnection: close\r\nHeader1: value1\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");

  g_object_unref (out);
}

static void
test_return_gerror_headers (void)
{
  GOutputStream *out;
  const gchar *data;
  GHashTable *headers;
  GError *error;

  out = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);

  headers = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_insert (headers, "Header1", "value1");

  error = g_error_new (G_IO_ERROR, G_IO_ERROR_FAILED, "Reason here: %s", "booyah");
  cockpit_web_server_return_gerror (out, headers, error);

  g_error_free (error);
  g_hash_table_destroy (headers);

  /* Null terminate it for fun */
  g_assert (g_output_stream_write (out, "\0", 1, NULL, NULL) == 1);

  data = g_memory_output_stream_get_data (G_MEMORY_OUTPUT_STREAM (out));
  g_assert_cmpstr (data, ==,
    "HTTP/1.1 500 Reason here: booyah\r\nContent-Length: 96\r\nConnection: close\r\nHeader1: value1\r\n\r\n<html><head><title>500 Reason here: booyah</title></head><body>Reason here: booyah</body></html>");

  g_object_unref (out);
}

static void
on_ready_get_result (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **retval = user_data;
  g_assert (retval && *retval == NULL);
  *retval = g_object_ref (result);
}

static gchar *
perform_http_request (gint port,
                      const gchar *request,
                      gsize *length)
{
  GSocketClient *client;
  GSocketConnection *conn;
  GAsyncResult *result;
  GInputStream *input;
  GError *error = NULL;
  GString *reply;
  gsize len;
  gssize ret;

  client = g_socket_client_new ();

  result = NULL;
  g_socket_client_connect_to_host_async (client, "localhost", port, NULL, on_ready_get_result, &result);
  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);
  conn = g_socket_client_connect_to_host_finish (client, result, &error);
  g_object_unref (result);
  g_assert_no_error (error);

  g_output_stream_write_all (g_io_stream_get_output_stream (G_IO_STREAM (conn)),
                             request, strlen (request), NULL, NULL, &error);
  g_assert_no_error (error);

  reply = g_string_new ("");
  input = g_io_stream_get_input_stream (G_IO_STREAM (conn));
  for (;;)
    {
      result = NULL;
      len = reply->len;
      g_string_set_size (reply, len + 1024);
      g_input_stream_read_async (input, reply->str + len, 1024, G_PRIORITY_DEFAULT,
                                 NULL, on_ready_get_result, &result);
      while (result == NULL)
        g_main_context_iteration (NULL, TRUE);
      ret = g_input_stream_read_finish (input, result, &error);
      g_object_unref (result);
      g_assert_no_error (error);
      g_assert (ret >= 0);
      g_string_set_size (reply, len + ret);
      if (ret == 0)
        break;
    }

  g_object_unref (conn);
  g_object_unref (client);

  *length = reply->len;
  return g_string_free (reply, FALSE);
}

static void
test_webserver_content_type (TestCase *tc,
                             gconstpointer user_data)
{
  GHashTable *headers;
  gchar *resp;
  gsize length;
  guint status;
  gssize off;

  resp = perform_http_request (tc->port, "GET /dbus-test.html HTTP/1.0\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  off = web_socket_util_parse_status_line (resp, length, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 200);

  off = web_socket_util_parse_headers (resp + off, length - off, &headers);
  g_assert_cmpuint (off, >, 0);

  g_assert_cmpstr (g_hash_table_lookup (headers, "Content-Type"), ==, "text/html");

  g_hash_table_unref (headers);
  g_free (resp);
}

static void
test_webserver_not_found (TestCase *tc,
                          gconstpointer user_data)
{
  gchar *resp;
  gsize length;
  guint status;
  gssize off;

  resp = perform_http_request (tc->port, "GET /non-existent\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  off = web_socket_util_parse_status_line (resp, length, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 404);

  g_free (resp);
}

static void
test_webserver_not_authorized (TestCase *tc,
                               gconstpointer user_data)
{
  gchar *resp;
  gsize length;
  guint status;
  gssize off;

  /* Listing a directory will result in 403 (except / -> index.html) */
  resp = perform_http_request (tc->port, "GET /po\r\n\r\n", &length);
  g_assert (resp != NULL);
  g_assert_cmpuint (length, >, 0);

  off = web_socket_util_parse_status_line (resp, length, &status, NULL);
  g_assert_cmpuint (off, >, 0);
  g_assert_cmpint (status, ==, 403);

  g_free (resp);
}

int
main (int argc,
      char *argv[])
{
#if !GLIB_CHECK_VERSION(2,36,0)
  g_type_init ();
#endif

  g_set_prgname ("test-webserver");
  g_test_init (&argc, &argv, NULL);

  g_test_add_func ("/web-server/table", test_table);
  g_test_add_func ("/web-server/return-content", test_return_content);
  g_test_add_func ("/web-server/return-content-headers", test_return_content_headers);
  g_test_add_func ("/web-server/return-error", test_return_error);
  g_test_add_func ("/web-server/return-error-headers", test_return_error_headers);
  g_test_add_func ("/web-server/return-gerror-headers", test_return_gerror_headers);

  g_test_add ("/web-server/content-type", TestCase, NULL,
              setup, test_webserver_content_type, teardown);
  g_test_add ("/web-server/not-found", TestCase, NULL,
              setup, test_webserver_not_found, teardown);
  g_test_add ("/web-server/not-authorized", TestCase, NULL,
              setup, test_webserver_not_authorized, teardown);

  return g_test_run ();
}
