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

#ifndef REAUTHORIZE_H__
#define REAUTHORIZE_H__

enum {
    REAUTHORIZE_REPLACE = 1 << 0,
};

int     reauthorize_listen     (int flags,
                                int *sock);

int     reauthorize_accept     (int sock,
                                int *connection);

int     reauthorize_recv       (int connection,
                                char **challenge);

int     reauthorize_send       (int connection,
                                const char *response);

int     reauthorize_type       (const char *challenge,
                                char **type);

int     reauthorize_user       (const char *challenge,
                                char **user);

int     reauthorize_crypt1     (const char *challenge,
                                const char *password,
                                char **response);

void    reauthorize_logger     (void (* func) (const char *),
                                int verbose);

#endif /* REAUTHORIZE_H__ */
