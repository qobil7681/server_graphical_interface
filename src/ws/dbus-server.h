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

#ifndef COCKPIT_DBUS_SERVER_H_337FCCD4982F4CBABD2F780D6158AAEC
#define COCKPIT_DBUS_SERVER_H_337FCCD4982F4CBABD2F780D6158AAEC

#include <gio/gio.h>

void      dbus_server_serve_dbus       (GBusType bus_type,
                                        const char *dbus_service,
                                        const char *dbus_path,
                                        int         fd_in,
                                        int         fd_out);

#endif
