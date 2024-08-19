/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#pragma once

#include <gnutls/gnutls.h>
#include <stdbool.h>

int
client_certificate_verify (gnutls_session_t session);

bool
client_certificate_accept (gnutls_session_t   session,
                           int                dirfd,
                           char             **out_wsinstance,
                           char             **out_filename);

void
client_certificate_unlink_and_free (int   dirfd,
                                    char *filename);
