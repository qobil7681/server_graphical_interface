/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#include "cockpittextstream.h"

#include "cockpit/cockpitpipe.h"

#include <gio/gunixsocketaddress.h>

/**
 * CockpitTextStream:
 *
 * A #CockpitChannel that sends messages from a regular socket
 * or file descriptor. Any data is read in whatever chunks it
 * shows up in read().
 *
 * Only UTF8 text data may be transmitted.
 *
 * The payload type for this channel is 'text-stream'.
 */

#define COCKPIT_TEXT_STREAM(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_TEXT_STREAM, CockpitTextStream))

typedef struct {
  CockpitChannel parent;
  CockpitPipe *pipe;
  GSocket *sock;
  const gchar *name;
  gboolean open;
  gboolean closing;
  guint sig_read;
  guint sig_closed;
} CockpitTextStream;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitTextStreamClass;

G_DEFINE_TYPE (CockpitTextStream, cockpit_text_stream, COCKPIT_TYPE_CHANNEL);

static void
cockpit_text_stream_recv (CockpitChannel *channel,
                          GBytes *message)
{
  CockpitTextStream *self = COCKPIT_TEXT_STREAM (channel);
  gconstpointer data;
  gsize len;

  data = g_bytes_get_data (message, &len);
  if (g_utf8_validate (data, len, NULL))
    {
      cockpit_pipe_write (self->pipe, message);
    }
  else
    {
      g_warning ("received non-textual data from web");
      if (self->open)
        cockpit_pipe_close (self->pipe, "protocol-error");
    }

}

static void
cockpit_text_stream_close (CockpitChannel *channel,
                           const gchar *problem)
{
  CockpitTextStream *self = COCKPIT_TEXT_STREAM (channel);

  self->closing = TRUE;

  /*
   * If closed, call base class handler directly. Otherwise ask
   * our pipe to close first, which will come back here.
  */
  if (self->open)
    cockpit_pipe_close (self->pipe, problem);
  else
    COCKPIT_CHANNEL_CLASS (cockpit_text_stream_parent_class)->close (channel, problem);
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *data,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitTextStream *self = user_data;
  CockpitChannel *channel = user_data;
  GBytes *message;

  if (data->len || !end_of_data)
    {
      if (g_utf8_validate ((gchar *)data->data, data->len, NULL))
        {
          /* When array is reffed, this just clears byte array */
          g_byte_array_ref (data);
          message = g_byte_array_free_to_bytes (data);
          cockpit_channel_send (channel, message);
          g_bytes_unref (message);
        } else {
            g_warning ("received non-textual data from socket");
            if (self->open)
              cockpit_pipe_close (pipe, "protocol-error");
        }
    }

  /* Close the pipe when writing is done */
  if (end_of_data && self->open)
    {
      g_debug ("%s: end of data, closing pipe", self->name);
      cockpit_pipe_close (pipe, NULL);
    }
}

static void
on_pipe_closed (CockpitPipe *buffer,
                const gchar *problem,
                gpointer user_data)
{
  CockpitTextStream *self = user_data;
  CockpitChannel *channel = user_data;
  self->open = FALSE;
  cockpit_channel_close (channel, problem);
}

static void
cockpit_text_stream_init (CockpitTextStream *self)
{

}

static gboolean
connect_in_idle (gpointer user_data)
{
  CockpitTextStream *self = COCKPIT_TEXT_STREAM (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GSocketAddress *address;
  const gchar *unix_path;
  GError *error = NULL;
  gint fd;

  if (self->closing)
    return FALSE;

  unix_path = cockpit_channel_get_option (channel, "unix");
  if (unix_path == NULL)
    {
      g_warning ("did not receive a unix option");
      cockpit_channel_close (channel, "protocol-error");
      return FALSE;
    }

  self->name = unix_path;
  address = g_unix_socket_address_new (unix_path);
  self->sock = g_socket_new (G_SOCKET_FAMILY_UNIX, G_SOCKET_TYPE_STREAM,
                             G_SOCKET_PROTOCOL_DEFAULT, &error);
  if (self->sock)
    {
      /* TODO: This needs to be non-blocking */
      if (g_socket_connect (self->sock, address, NULL, &error))
        {
          fd = g_socket_get_fd (self->sock);
          self->pipe = g_object_new (COCKPIT_TYPE_PIPE,
                                     "name", unix_path,
                                     "in-fd", fd,
                                     "out-fd", fd,
                                     NULL);
          self->sig_read = g_signal_connect (self->pipe, "read", G_CALLBACK (on_pipe_read), self);
          self->sig_closed = g_signal_connect (self->pipe, "closed", G_CALLBACK (on_pipe_closed), self);
          self->open = TRUE;
          cockpit_channel_ready (channel);
        }
    }

  if (error)
    {
      g_warning ("%s: %s", unix_path, error->message);
      g_error_free (error);
      cockpit_channel_close (channel, "internal-error");
    }

  g_object_unref (address);
  return FALSE; /* don't run again */
}

static void
cockpit_text_stream_constructed (GObject *object)
{
  G_OBJECT_CLASS (cockpit_text_stream_parent_class)->constructed (object);

  /* Guarantee not to close immediately */
  g_idle_add_full (G_PRIORITY_DEFAULT, connect_in_idle,
                   g_object_ref (object), g_object_unref);
}

static void
cockpit_text_stream_dispose (GObject *object)
{
  CockpitTextStream *self = COCKPIT_TEXT_STREAM (object);

  if (self->pipe)
    {
      if (self->open)
        cockpit_pipe_close (self->pipe, "terminated");
      if (self->sig_read)
        g_signal_handler_disconnect (self->pipe, self->sig_read);
      if (self->sig_closed)
        g_signal_handler_disconnect (self->pipe, self->sig_closed);
      self->sig_read = self->sig_closed = 0;
    }

  G_OBJECT_CLASS (cockpit_text_stream_parent_class)->dispose (object);
}

static void
cockpit_text_stream_finalize (GObject *object)
{
  CockpitTextStream *self = COCKPIT_TEXT_STREAM (object);

  g_clear_object (&self->sock);
  g_clear_object (&self->pipe);

  G_OBJECT_CLASS (cockpit_text_stream_parent_class)->finalize (object);
}

static void
cockpit_text_stream_class_init (CockpitTextStreamClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->constructed = cockpit_text_stream_constructed;
  gobject_class->dispose = cockpit_text_stream_dispose;
  gobject_class->finalize = cockpit_text_stream_finalize;

  channel_class->recv = cockpit_text_stream_recv;
  channel_class->close = cockpit_text_stream_close;
}

/**
 * cockpit_text_stream_open:
 * @transport: the transport to send/receive messages on
 * @number: the channel number
 * @unix_path: the UNIX socket path to communicate with
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitTextStream is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_text_stream_open (CockpitTransport *transport,
                          guint number,
                          const gchar *unix_path)
{
  CockpitChannel *channel;
  JsonObject *options;

  options = json_object_new ();
  json_object_set_string_member (options, "unix", unix_path);
  json_object_set_string_member (options, "payload", "text-stream");

  channel = g_object_new (COCKPIT_TYPE_TEXT_STREAM,
                          "transport", transport,
                          "channel", number,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
