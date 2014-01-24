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

#include <stdio.h>
#include <math.h>

#include <glib.h>

#include "libgsystem.h"
#include "daemon.h"
#include "auth.h"
#include "storagejob.h"
#include "storageprovider.h"

typedef struct _StorageJobClass StorageJobClass;

struct _StorageJob
{
  CockpitJobSkeleton parent_instance;

  UDisksJob *udisks_job;
};

struct _StorageJobClass
{
  CockpitJobSkeletonClass parent_class;
};

static void storage_job_iface_init (CockpitJobIface *iface);

G_DEFINE_TYPE_WITH_CODE (StorageJob, storage_job, COCKPIT_TYPE_JOB_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_JOB, storage_job_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
on_completed (UDisksJob *object,
              gboolean arg_success,
              gchar *arg_message,
              gpointer user_data)
{
  if (!arg_success)
    g_log ("storage", G_LOG_LEVEL_WARNING, "%s", arg_message);
}

static void
update (StorageJob *job)
{
  CockpitJob *rjob = COCKPIT_JOB(job);
  cockpit_job_set_cancellable (rjob, udisks_job_get_cancelable (job->udisks_job));

  cockpit_job_set_progress (rjob, udisks_job_get_progress (job->udisks_job));
  cockpit_job_set_progress_valid (rjob, udisks_job_get_progress_valid (job->udisks_job));

  guint64 end = udisks_job_get_expected_end_time (job->udisks_job);
  guint64 now = g_get_real_time ();
  if (end > now)
    cockpit_job_set_remaining_usecs (rjob, end - now);
  else
    cockpit_job_set_remaining_usecs (rjob, 0);
}

static void
on_notify (GObject *object,
           GParamSpec *pspec,
           gpointer user_data)
{
  StorageJob *job = STORAGE_JOB (user_data);
  update (job);
}

static gboolean
handle_cancel (CockpitJob *object,
               GDBusMethodInvocation *invocation)
{
  StorageJob *job = STORAGE_JOB (object);
  GError *error = NULL;

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_STORAGE_ADMIN))
    return TRUE;

  if (!udisks_job_call_cancel_sync (job->udisks_job,
                                    g_variant_new ("a{sv}", NULL),
                                    NULL,
                                    &error))
    {
      g_dbus_method_invocation_take_error (invocation, error);
      return TRUE;
    }

  cockpit_job_complete_cancel (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_job_finalize (GObject *object)
{
  StorageJob *job = STORAGE_JOB (object);

  g_signal_handlers_disconnect_by_func (job->udisks_job, G_CALLBACK (on_completed), job);
  g_signal_handlers_disconnect_by_func (job->udisks_job, G_CALLBACK (on_notify), job);
  g_object_unref (job->udisks_job);

  G_OBJECT_CLASS (storage_job_parent_class)->finalize (object);
}

static void
storage_job_init (StorageJob *self)
{
}

static void
storage_job_class_init (StorageJobClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = storage_job_finalize;
}

CockpitJob *
storage_job_new (StorageProvider *provider,
                 GDBusObject *udisks_or_lvm_object)
{
  CockpitJob *job = COCKPIT_JOB (g_object_new (TYPE_STORAGE_JOB, NULL));
  UDisksJob *udisks_job;

  if (UDISKS_IS_OBJECT (udisks_or_lvm_object))
    {
      udisks_job = udisks_object_get_job (UDISKS_OBJECT (udisks_or_lvm_object));
    }
  else
    {
      const gchar *path = g_dbus_object_get_object_path (udisks_or_lvm_object);
      g_debug ("Creating new proxy for %s", path);
      udisks_job = udisks_job_proxy_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                                      0,
                                                      "com.redhat.lvm2",
                                                      path,
                                                      NULL,
                                                      NULL);
    }

  STORAGE_JOB(job)->udisks_job = udisks_job;
  if (udisks_job == NULL)
    return job;

  g_signal_connect (udisks_job, "completed", G_CALLBACK (on_completed), job);
  g_signal_connect (udisks_job, "notify", G_CALLBACK (on_notify), job);

  cockpit_job_set_domain (job, "storage");
  cockpit_job_set_operation (job, udisks_job_get_operation (udisks_job));

  const gchar *const *objects = udisks_job_get_objects (udisks_job);
  int n_objects = (objects ? g_strv_length ((gchar **)objects) : 0);
  const gchar **targets = g_new0 (const gchar *, n_objects + 1);
  for (int i = 0; i < n_objects; i++)
    targets[i] = storage_provider_translate_path (provider, objects[i]);
  cockpit_job_set_targets (job, targets);
  g_free (targets);

  update (STORAGE_JOB(job));

  return job;
}

static void
storage_job_iface_init (CockpitJobIface *iface)
{
  iface->handle_cancel = handle_cancel;
}
