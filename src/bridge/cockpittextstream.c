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

#include "common/cockpitpipe.h"

#include "common/cockpitunixsignal.h"

#include <gio/gunixsocketaddress.h>

#include <sys/wait.h>

/**
 * CockpitTextStream:
 *
 * A #CockpitChannel that sends messages from a regular socket
 * or file descriptor. Any data is read in whatever chunks it
 * shows up in read().
 *
 * Only UTF8 text data is transmitted. Anything else is
 * forced into UTF8 by replacing invalid characters.
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
  guint sig_close;
  gint batch_size;
  guint batch_timeout;
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
  cockpit_pipe_write (self->pipe, message);
}

static void
process_pipe_buffer (CockpitTextStream *self,
                     GByteArray *data)
{
  CockpitChannel *channel = (CockpitChannel *)self;
  GBytes *message;

  if (self->batch_timeout)
    {
      g_source_remove (self->batch_timeout);
      self->batch_timeout = 0;
    }

  if (data->len)
    {
      /* When array is reffed, this just clears byte array */
      g_byte_array_ref (data);
      message = g_byte_array_free_to_bytes (data);
      cockpit_channel_send (channel, message, FALSE);
      g_bytes_unref (message);
    }
}

static void
cockpit_text_stream_close (CockpitChannel *channel,
                           const gchar *problem)
{
  CockpitTextStream *self = COCKPIT_TEXT_STREAM (channel);

  self->closing = TRUE;
  if (self->pipe)
    process_pipe_buffer (self, cockpit_pipe_get_buffer (self->pipe));

  /*
   * If closed, call base class handler directly. Otherwise ask
   * our pipe to close first, which will come back here.
  */
  if (self->open)
    cockpit_pipe_close (self->pipe, problem);
  else
    COCKPIT_CHANNEL_CLASS (cockpit_text_stream_parent_class)->close (channel, problem);
}

static gboolean
on_batch_timeout (gpointer user_data)
{
  CockpitTextStream *self = user_data;
  self->batch_timeout = 0;
  process_pipe_buffer (self, cockpit_pipe_get_buffer (self->pipe));
  return FALSE;
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *data,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitTextStream *self = user_data;

  if (!end_of_data &&
      self->batch_size > 0 &&
      data->len < self->batch_size)
    {
      /* Delay the processing of this data */
      if (!self->batch_timeout)
        self->batch_timeout = g_timeout_add (75, on_batch_timeout, self);
    }
  else
    {
      process_pipe_buffer (self, data);
    }

  /* Close the pipe when writing is done */
  if (end_of_data && self->open)
    {
      g_debug ("%s: end of data, closing pipe", self->name);
      cockpit_pipe_close (pipe, NULL);
    }
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitTextStream *self = user_data;
  CockpitChannel *channel = user_data;
  gint status;
  gchar *signal;

  process_pipe_buffer (self, cockpit_pipe_get_buffer (self->pipe));

  self->open = FALSE;

  if (cockpit_pipe_get_pid (pipe, NULL))
    {
      status = cockpit_pipe_exit_status (pipe);
      if (WIFEXITED (status))
        cockpit_channel_close_int_option (channel, "exit-status", WEXITSTATUS (status));
      else if (WIFSIGNALED (status))
        {
          signal = cockpit_strsignal (WTERMSIG (status));
          cockpit_channel_close_option (channel, "exit-signal", signal);
          g_free (signal);
        }
      else if (status)
        cockpit_channel_close_int_option (channel, "exit-status", -1);
    }

  cockpit_channel_close (channel, problem);
}

static void
cockpit_text_stream_init (CockpitTextStream *self)
{

}

static void
cockpit_text_stream_constructed (GObject *object)
{
  CockpitTextStream *self = COCKPIT_TEXT_STREAM (object);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GSocketAddress *address;
  CockpitPipeFlags flags;
  const gchar *unix_path;
  const gchar **argv;
  const gchar **env;
  const gchar *dir;
  const gchar *error;

  G_OBJECT_CLASS (cockpit_text_stream_parent_class)->constructed (object);

  unix_path = cockpit_channel_get_option (channel, "unix");
  argv = cockpit_channel_get_strv_option (channel, "spawn");

  if (argv == NULL && unix_path == NULL)
    {
      g_warning ("did not receive a unix or spawn option");
      cockpit_channel_close (channel, "protocol-error");
      return;
    }
  else if (argv != NULL && unix_path != NULL)
    {
      g_warning ("received both a unix and spawn option");
      cockpit_channel_close (channel, "protocol-error");
      return;
    }
  else if (unix_path)
    {
      self->name = unix_path;
      address = g_unix_socket_address_new (unix_path);
      self->pipe = cockpit_pipe_connect (self->name, address);
      g_object_unref (address);
    }
  else if (argv)
    {
      flags = COCKPIT_PIPE_STDERR_TO_LOG;
      error = cockpit_channel_get_option (channel, "error");
      if (error && g_str_equal (error, "output"))
        flags = COCKPIT_PIPE_STDERR_TO_STDOUT;

      self->name = argv[0];
      env = cockpit_channel_get_strv_option (channel, "environ");
      dir = cockpit_channel_get_option (channel, "directory");
      if (cockpit_channel_get_bool_option (channel, "pty", FALSE))
        self->pipe = cockpit_pipe_pty (argv, env, dir);
      else
        self->pipe = cockpit_pipe_spawn (argv, env, dir, flags);
    }

  self->batch_size = cockpit_channel_get_int_option (channel, "batch");

  self->sig_read = g_signal_connect (self->pipe, "read", G_CALLBACK (on_pipe_read), self);
  self->sig_close = g_signal_connect (self->pipe, "close", G_CALLBACK (on_pipe_close), self);
  self->open = TRUE;
  cockpit_channel_ready (channel);
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
      if (self->sig_close)
        g_signal_handler_disconnect (self->pipe, self->sig_close);
      self->sig_read = self->sig_close = 0;
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
 * @channel_id: the channel id
 * @unix_path: the UNIX socket path to communicate with
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitTextStream is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_text_stream_open (CockpitTransport *transport,
                          const gchar *channel_id,
                          const gchar *unix_path)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "unix", unix_path);
  json_object_set_string_member (options, "payload", "text-stream");

  channel = g_object_new (COCKPIT_TYPE_TEXT_STREAM,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
