/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import cockpit from "cockpit";
import React from "react";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { ExclamationTriangleIcon, ExclamationCircleIcon } from "@patternfly/react-icons";

import { SCard } from "./utils/card.jsx";
import { decode_filename } from "./utils.js";
import { fmt_to_fragments } from "utils.jsx";

import { StorageButton, StorageBarMenu, StorageMenuItem } from "./storage-controls.jsx";

const _ = cockpit.gettext;

let pages = null;
let crossrefs = null;

export function reset_pages() {
    pages = new Map();
    crossrefs = new Map();
}

function name_from_container(container) {
    if (!container)
        return null;
    if (container.page_name)
        return container.page_name;
    return name_from_container(container.parent);
}

function location_from_container(container) {
    if (!container)
        return null;
    if (container.page_location)
        return container.page_location;
    return location_from_container(container.parent);
}

export function new_page({
    location, parent, container,
    name, component, props, columns, has_warning, has_danger, actions
}) {
    const loc = location_from_container(container) || location;
    const page = {
        location: loc,
        name: name_from_container(container) || name,
        parent,
        component,
        props: props || {},
        children: [],
        container,
        columns: columns || [],
        has_warning,
        has_danger,
        actions: actions ? actions.filter(a => !!a) : null,
    };
    if (parent)
        parent.children.push(page);
    while (container) {
        container.page = page;
        container = container.parent;
    }
    if (loc) {
        pages.set(JSON.stringify(loc), page);
        if (loc.length == 0) {
            // This is the Overview page. Make it the parent of the
            // special "not found" page (but don't make the "not
            // found" page a child of the Overview...)
            not_found_page.parent = page;
        }
    }
    return page;
}

export function new_container({
    parent,
    type_format, stored_on_format, page_name, page_location,
    component, props,
    has_warning, has_danger, actions
}) {
    return {
        parent,
        type_format,
        stored_on_format,
        page_name,
        page_location,
        component,
        props,
        has_warning,
        has_danger,
        actions: actions ? actions.filter(a => !!a) : null,
    };
}

export function register_crossref(crossref) {
    const val = crossrefs.get(crossref.key) || [];
    val.push(crossref);
    crossrefs.set(crossref.key, val);
}

export function get_crossrefs(key) {
    return crossrefs.get(key);
}

/* Getting the page for a navigation location.
 *
 * We have a special "not found" page that is returned when there is
 * no real page at the given location.
 */

const NotFoundPage = ({ page }) => {
    return <span>{_("Not found")}</span>;
};

const not_found_page = new_page({
    name: "Not found",
    component: NotFoundPage
});

export function get_page_from_location(location) {
    if (!pages)
        return not_found_page;

    return pages.get(JSON.stringify(location)) || not_found_page;
}

/* Common UI things
 */

export function navigate_away_from_page(page) {
    const loc = cockpit.location;
    console.log('navigate away');
    if (page.parent && JSON.stringify(loc.path) == JSON.stringify(page.location))
        loc.go(page.parent.location);
}

export function navigate_to_new_page_location(page, location) {
    const loc = cockpit.location;
    if (JSON.stringify(loc.path) == JSON.stringify(page.location))
        loc.go(location);
}

function make_menu_item(action) {
    return <StorageMenuItem key={action.title} onClick={action.action}
                            danger={action.danger} excuse={action.excuse}>
        {action.title}
    </StorageMenuItem>;
}

function make_page_kebab(page) {
    const items = [];

    function add_actions(actions) {
        if (!actions)
            return;
        for (const a of actions) {
            // Dangerous and impossible actions are omitted from the
            // kebab menus. The user needs to go to the page itself to
            // fo dangerous stuff, and see the reason for why
            // something is impossible.
            //
            // Pages that don't really exist ("Free space" and
            // "Extended partition") get all their actions in the
            // menu, because there is no other place.
            //
            if (!page.location || (!a.danger && !a.excuse))
                items.push(make_menu_item(a));
        }
    }

    add_actions(page.actions);
    let cont = page.container;
    while (cont) {
        add_actions(cont.actions);
        cont = cont.parent;
    }

    if (items.length == 0)
        return null;

    return <StorageBarMenu menuItems={items} isKebab />;
}

function make_actions_kebab(actions) {
    if (actions.length == 0)
        return null;

    return <StorageBarMenu menuItems={actions.map(make_menu_item)} isKebab />;
}

export const ActionButtons = ({ page, container, tag }) => {
    const actions = page ? page.actions : container.actions;
    if (!actions)
        return null;

    return actions
            .filter(a => !tag || a.tag == tag)
            .map(a =>
                <StorageButton key={a.title} onClick={a.action} kind={a.danger ? "danger" : null} excuse={a.excuse}>
                    {a.title}
                </StorageButton>);
};

export function page_type(page) {
    let type = page.columns[0];

    let cont = page.container;
    while (cont) {
        if (cont.type_format)
            type = cockpit.format(cont.type_format, type);
        cont = cont.parent;
    }

    return type;
}

export function page_stored_on(page) {
    function apply_container_format(cont, text) {
        if (cont) {
            text = apply_container_format(cont.parent, text);
            if (cont.stored_on_format)
                text = cockpit.format(cont.stored_on_format, text);
        }
        return text;
    }

    return apply_container_format(page.container, page.parent.name);
}

const PageTable = ({ emptyCaption, aria_label, pages, crossrefs }) => {
    const rows = [];

    function container_has_danger(container) {
        if (container)
            return container.has_danger || container_has_danger(container.parent);
        else
            return false;
    }

    function container_has_warning(container) {
        if (container)
            return container.has_warning || container_has_warning(container.parent);
        else
            return false;
    }

    function make_row(page, crossref, level, key, border) {
        console.log("P", page.name, border);
        let info = null;
        if (page.has_danger || container_has_danger(page.container))
            info = <>{"\n"}<ExclamationCircleIcon className="ct-icon-times-circle" /></>;
        else if (page.has_warning || container_has_warning(page.container))
            info = <>{"\n"}<ExclamationTriangleIcon className="ct-icon-exclamation-triangle" /></>;
        const type_colspan = page.columns[1] ? 1 : 2;
        const cols = [
            <Td key="1"><span>{page.name}{info}</span></Td>,
            <Td key="2" colSpan={type_colspan}>{crossref ? page_stored_on(page) : page_type(page)}</Td>,
        ];
        if (type_colspan == 1)
            cols.push(<Td key="3">{crossref ? null : page.columns[1]}</Td>);
        cols.push(
            <Td key="4" className="pf-v5-u-text-align-right">
                {crossref ? crossref.size : page.columns[2]}
            </Td>);
        cols.push(
            <Td key="5" className="pf-v5-c-table__action content-action">
                {crossref ? make_actions_kebab(crossref.actions) : make_page_kebab(page)}
            </Td>);

        function onRowClick(event) {
            if (!event || event.button !== 0)
                return;

            // StorageBarMenu sets this to tell us not to navigate when
            // the kebabs are opened.
            if (event.defaultPrevented)
                return;

            if (page.location)
                cockpit.location.go(page.location);
        }

        return <Tr key={key} className={"content-level-" + level + (border ? "" : " ct-no-border")}
                   data-test-row-name={page.name} data-test-row-location={page.columns[1]}
                   isClickable={!!page.location} onRowClick={onRowClick}>
            {cols}
        </Tr>;
    }

    function make_page_rows(pages, level, last_has_border) {
        for (const p of pages) {
            const is_last = (level == 0 || p == pages[pages.length - 1]);
            rows.push(make_row(p, null, level, rows.length, is_last && p.children.length == 0 && last_has_border));
            make_page_rows(p.children, level + 1, is_last && last_has_border);
        }
    }

    function make_crossref_rows(crossrefs) {
        for (const c of crossrefs) {
            rows.push(make_row(c.page, c, 0, rows.length, true));
        }
    }

    if (pages)
        make_page_rows(pages, 0, true);
    else if (crossrefs)
        make_crossref_rows(crossrefs);

    if (rows.length == 0) {
        return <EmptyState>
            <EmptyStateBody>
                {emptyCaption}
            </EmptyStateBody>
        </EmptyState>;
    }

    return (
        <Table aria-label={aria_label}
               variant="compact">
            <Thead>
                <Tr>
                    <Th>{_("ID")}</Th>
                    <Th>{_("Type")}</Th>
                    <Th>{_("Location")}</Th>
                    <Th>{_("Size")}</Th>
                </Tr>
            </Thead>
            <Tbody>
                {rows}
            </Tbody>
        </Table>);
};

export const PageChildrenCard = ({ title, page, emptyCaption, actions }) => {
    return (
        <SCard title={title} actions={actions}>
            <CardBody className="contains-list">
                <PageTable emptyCaption={emptyCaption || _("No storage found")}
                           aria-label={title}
                           pages={page.children} />
            </CardBody>
        </SCard>);
};

export const PageCrossrefCard = ({ title, crossrefs, emptyCaption, actions }) => {
    return (
        <SCard title={title} actions={actions}>
            <CardBody className="contains-list">
                <PageTable emptyCaption={emptyCaption || _("No storage found")}
                           aria-label={title}
                           crossrefs={crossrefs}
                           isLinks />
            </CardBody>
        </SCard>);
};

export const ParentPageLink = ({ page }) => {
    function apply_container_format(cont, link) {
        if (cont) {
            link = apply_container_format(cont.parent, link);
            if (cont.stored_on_format)
                link = fmt_to_fragments(cont.stored_on_format, link);
        }
        return link;
    }

    const pp = page.parent;
    const link = (
        <Button isInline variant="link" onClick={() => cockpit.location.go(pp.location)}>
            {pp.name}
        </Button>);

    return apply_container_format(page.container, link);
};

export const Container = ({ container }) => {
    return <container.component container={container} {...container.props} />;
};

export const PageContainerStackItems = ({ page }) => {
    const items = [];
    let cont = page.container;
    while (cont) {
        items.push(<StackItem key={items.length}><Container container={cont} /></StackItem>);
        cont = cont.parent;
    }
    return items;
};

export function block_location(block) {
    return decode_filename(block.PreferredDevice).replace(/^\/dev\//, "");
}
