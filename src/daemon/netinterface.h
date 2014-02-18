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

#ifndef COCKPIT_NETINTERFACE_H_98563854D09546DE83C155C9A7522E94
#define COCKPIT_NETINTERFACE_H_98563854D09546DE83C155C9A7522E94

#include "types.h"

G_BEGIN_DECLS

#define TYPE_NETINTERFACE  (netinterface_get_type ())
#define NETINTERFACE(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_NETINTERFACE, Netinterface))
#define IS_NETINTERFACE(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_NETINTERFACE))

GType                         netinterface_get_type    (void) G_GNUC_CONST;

CockpitNetworkNetinterface *  netinterface_new         (Network *network,
                                                        const gchar   *name);

Network *                     netinterface_get_network (Netinterface *network);

G_END_DECLS

#endif /* COCKPIT_NETINTERFACE_H__ */
