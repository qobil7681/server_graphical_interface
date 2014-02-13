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

#ifndef COCKPIT_JOURNAL_H__
#define COCKPIT_JOURNAL_H__

#include "types.h"

G_BEGIN_DECLS

#define TYPE_JOURNAL  (journal_get_type ())
#define JOURNAL(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_JOURNAL, Journal))
#define IS_JOURNAL(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_JOURNAL))

GType             journal_get_type    (void) G_GNUC_CONST;

CockpitJournal *  journal_new         (void);

G_END_DECLS

#endif /* COCKPIT_JOURNAL_H__ */
