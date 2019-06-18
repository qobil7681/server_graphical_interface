/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

#ifndef COCKPIT_FLOW_H__
#define COCKPIT_FLOW_H__

#include <glib-object.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_FLOW             (cockpit_flow_get_type ())
#define COCKPIT_FLOW(inst)            (G_TYPE_CHECK_INSTANCE_CAST ((inst), COCKPIT_TYPE_FLOW, CockpitFlow))
#define COCKPIT_IS_FLOW(inst)         (G_TYPE_CHECK_INSTANCE_TYPE ((inst), COCKPIT_TYPE_FLOW))
#define COCKPIT_FLOW_GET_IFACE(inst)  (G_TYPE_INSTANCE_GET_INTERFACE ((inst), COCKPIT_TYPE_FLOW, CockpitFlowInterface))

typedef struct _CockpitFlow CockpitFlow;
typedef struct _CockpitFlowInterface CockpitFlowInterface;

struct _CockpitFlowInterface {
  GTypeInterface parent_iface;

  void       (* throttle)         (CockpitFlow *flow,
                                   CockpitFlow *controlling);
};

GType               cockpit_flow_get_type        (void) G_GNUC_CONST;

void                cockpit_flow_throttle        (CockpitFlow *flow,
                                                  CockpitFlow *controller);

void                cockpit_flow_emit_pressure   (CockpitFlow *flow,
                                                  gboolean pressure);

G_END_DECLS

#endif /* COCKPIT_FLOW_H__ */
