/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

import $ from "jquery";
import cockpit from "cockpit";

import { mustache } from "mustache";
import * as service from "service";

import * as client from "./client";
import { init_overview } from "./overview";
import { init_container_details } from "./details";
import { init_image_details } from "./image";
import { init_storage } from "./storage.jsx";

import "page.css";
import "table.css";
import "./docker.css";

const _ = cockpit.gettext;

/* CURTAIN
 */

var curtain_tmpl;
var docker_service = service.proxy("docker");

function init_curtain(client, navigate) {
    curtain_tmpl = $("#curtain-tmpl").html();
    mustache.parse(curtain_tmpl);

    $(client).on('failure', function (event, error) {
        show_curtain(error);
    });

    $('#curtain').on('click', '[data-action=docker-start]', function () {
        show_curtain(null);
        docker_service.start()
                .done(function () {
                    client.close();
                    client.connect().done(navigate);
                })
                .fail(function (error) {
                    show_curtain(cockpit.format(_("Failed to start Docker: $0"), error));
                });
    });

    $('#curtain').on('click', '[data-action=docker-connect]', function () {
        show_curtain(null);
        client.close();
        client.connect().done(navigate);
    });
}

function show_curtain(ex) {
    var info = { };

    if (ex === null) {
        info.connecting = true;
    } else if (typeof ex == "string") {
        info.other = ex;
        console.warn(ex);
    } else if (ex.problem == "not-found") {
        info.notfound = true;
    } else if (ex.problem == "access-denied") {
        info.denied = true;
    } else {
        info.other = ex.toString();
        console.warn(ex);
    }

    $('#curtain').html(mustache.render(curtain_tmpl, info));
    $('body > div').prop("hidden", true);
    $('#curtain').prop("hidden", false);
    $("body").prop("hidden", false);
}

function hide_curtain() {
    $('#curtain').prop("hidden", true);
}

/* INITIALIZATION AND NAVIGATION
 */

function init() {
    var docker_client;
    var overview_page;
    var container_details_page;
    var image_details_page;
    var storage_page;

    function navigate() {
        var path = cockpit.location.path;

        $("body").prop("hidden", false);
        hide_curtain();
        if (path.length === 0) {
            container_details_page.hide();
            image_details_page.hide();
            storage_page.hide();
            overview_page.show();
        } else if (path.length === 1 && path[0] == "storage") {
            overview_page.hide();
            container_details_page.hide();
            image_details_page.hide();
            storage_page.show();
        } else if (path.length === 1) {
            overview_page.hide();
            image_details_page.hide();
            storage_page.hide();
            container_details_page.show(path[0]);
        } else if (path.length === 2 && path[0] == "image") {
            overview_page.hide();
            container_details_page.hide();
            storage_page.hide();
            image_details_page.show(path[1]);
        } else { /* redirect */
            console.warn("not a containers location: " + path);
            cockpit.location = '';
        }
    }

    cockpit.translate();

    docker_client = client.instance();
    init_curtain(docker_client, navigate);
    overview_page = init_overview(docker_client);
    container_details_page = init_container_details(docker_client);
    image_details_page = init_image_details(docker_client);
    storage_page = init_storage(docker_client);

    show_curtain(null);
    docker_client.connect().done(navigate);
    $(cockpit).on("locationchanged", navigate);
}

$(init);
