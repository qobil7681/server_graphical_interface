# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2013 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

from contextlib import contextmanager
import os
import sys
import subprocess
import shutil
import stat
import tempfile
import time
from common import testinfra

BASE = testinfra.TEST_DIR
IMAGES = os.path.join(BASE, "images")
DATA = os.path.join(os.environ.get("TEST_DATA", BASE), "images")
# this is the path git uses within the repo, not on the filesystem (which would be IMAGES)
GIT_IMAGE_PATH = "test/images"

# threshold in G below which unreferenced qcow2 images will be pruned, even if they aren't old
PRUNE_THRESHOLD_G = float(os.environ.get("PRUNE_THRESHOLD_G", 15))
DEVNULL = open("/dev/null", "r+")

CONFIG = "~/.config/image-stores"
DEFAULT = "https://fedorapeople.org/groups/cockpit/images/"

def download(link, force, stores):
    if not os.path.exists(DATA):
        os.makedirs(DATA)

    dest = os.readlink(link)
    relative_dir = os.path.dirname(os.path.abspath(link))
    full_dest = os.path.join(relative_dir, dest)
    while not ".qcow2" in dest and os.path.islink(full_dest):
        link = full_dest
        dest = os.readlink(link)
        relative_dir = os.path.dirname(os.path.abspath(link))
        full_dest = os.path.join(relative_dir, dest)

    dest = os.path.join(DATA, dest)

    # we have the file but there is not valid link
    if os.path.exists(dest) and not os.path.exists(link):
        os.symlink(dest, os.path.join(IMAGES, os.readlink(link)))

    # The image file in the images directory, may be same as dest
    image_file = os.path.join(IMAGES, os.readlink(link))

    # file already exists, double check that symlink in place
    if not force and os.path.exists(dest):
        if not os.path.exists(image_file):
            os.symlink(os.path.abspath(dest), image_file)
        return

    if not stores:
        config = os.path.expanduser(CONFIG)
        if os.path.exists(config):
            with open(config, 'r') as fp:
                stores = fp.read().strip().split("\n")
        else:
            stores = []
        stores.append(DEFAULT)

    for store in stores:
        try:
            source = os.path.join(store, os.path.basename(dest)) + ".xz"
            subprocess.check_call(["curl", "-s", "-f", "-I", source], stdout=DEVNULL)
            break
        except:
            continue

    sys.stderr.write("{0}\n".format(source))

    # Download the xz compressed qcow2 file and extract it on the fly.
    # If TEST_DATA is configured we also keep around the xz form so that we
    # could share it with other testers too.
    (fd, temp) = tempfile.mkstemp(suffix=".partial", prefix=os.path.basename(dest), dir=DATA)
    tempxz = None
    if "TEST_DATA" in os.environ:
        tempxz = temp + ".xz"

    try:
        proc = curl = subprocess.Popen(["curl", "-#", "-f", source], stdout=subprocess.PIPE)
        if tempxz:
            proc = tee = subprocess.Popen(["tee", temp + ".xz"], stdin=curl.stdout, stdout=subprocess.PIPE)
        unxz = subprocess.Popen(["unxz", "--stdout", "-"], stdin=proc.stdout, stdout=fd)

        curl.stdout.close()
        if tempxz:
            tee.stdout.close()
            tee.wait()
        ret = curl.wait()
        if ret != 0:
            raise Exception("curl: unable to download image (returned: %s)" % ret)
        ret = unxz.wait()
        if ret != 0:
            raise Exception("unxz: unable to unpack image (returned: %s)" % ret)

        os.close(fd)
        os.chmod(temp, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        shutil.move(temp, dest)
        if tempxz:
            shutil.move(tempxz, dest + ".xz")
    finally:
        # if we had an error and the temp file is left over, delete it
        if os.path.exists(temp):
            os.unlink(temp)
        if tempxz and os.path.exists(tempxz):
            os.unlink(tempxz)

    # Handle alternate TEST_DATA
    if not os.path.exists(image_file):
        os.symlink(os.path.abspath(dest), image_file)

def enough_disk_space():
    """Check if available disk space in our data store is sufficient
    """
    st = os.statvfs(DATA)
    free = st.f_bavail * st.f_frsize / (1024*1024*1024)
    return free >= PRUNE_THRESHOLD_G;

def get_refs(pull_requests=[], offline=False):
    """Return dictionary for available refs of the format {'rhel-7.4': 'ad50328990e44c22501bd5e454746d4b5e561b7c'}

       Expects to be called from the top level of the git checkout
    """
    # get all remote heads and filter empty lines
    # output of ls-remote has the format
    #
    # d864d3792db442e3de3d1811fa4bc371793a8f4f	refs/heads/master
    # ad50328990e44c22501bd5e454746d4b5e561b7c	refs/heads/rhel-7.4
    git_cmd = "show-ref" if offline else "ls-remote"
    ref_output = subprocess.check_output(["git", git_cmd]).splitlines()
    # filter out the "refs/heads/" prefix or pull request and generate a dictionary
    prefix = "refs/heads"
    pr_prefix = "refs/remotes/origin/pr/"
    refs = { }
    for ln in ref_output:
        [ref, name] = ln.split()
        if name.startswith(prefix):
            refs[name[len(prefix):]] = ref
        elif name.startswith(pr_prefix):
            pr = name.split("/")[-1]
            if pr in pull_requests:
                refs[pr] = ref
            else:
                # also accept pull requests as actual numbers
                try:
                    pr = int(pr)
                    if pr in pull_requests:
                        refs[str(pr)] = ref
                except ValueError as e:
                    pass
    return refs

def get_image_links(ref):
    """Return all image links for the given git ref

       Expects to be called from the top level of the git checkout
    """
    # get all the links we have first
    # trailing slash on GIT_IMAGE_PATH is important
    git_path = GIT_IMAGE_PATH if GIT_IMAGE_PATH.endswith("/") else "{0}/".format(GIT_IMAGE_PATH)
    try:
        entries = subprocess.check_output(["git", "ls-tree",  "--name-only", ref, git_path]).splitlines()
    except subprocess.CalledProcessError, e:
        if e.returncode == 128:
            sys.stderr.write("Skipping {0} due to tree error.\n".format(ref))
            return []
        raise
    links = map(lambda entry: subprocess.check_output(["git", "show", "{0}:{1}".format(ref, entry)]), entries)
    return [link for link in links if link.endswith(".qcow2")]

@contextmanager
def remember_cwd():
    curdir = os.getcwd()
    try:
        yield
    finally:
        os.chdir(curdir)

def get_image_names(pull_requests=[]):
    """Return all image names used by all branches

       Also include images used in the given pull_requests, e.g. ["6432","6434","6500"] or a list of all open pull requests
    """
    images = set()
    # iterate over visible refs (mostly branches)
    # this hinges on being in the top level directory of the the git checkout
    with remember_cwd():
        os.chdir(os.path.join(BASE, ".."))
        refs = get_refs()
        # list images present in each branch / pull request
        for name, ref in refs.items():
            sys.stderr.write("Considering images from {0} ({1})\n".format(name, ref))
            for link in get_image_links(ref):
                images.add(link)

    return images

def prune_images(force, dryrun):
    now = time.time()
    # everything we want to keep
    targets = set()
    def maybe_add_target(target):
        # if the path isn't absolute, it can resolve to either the images directory or here (might be the same)
        if not os.path.isabs(target):
            targets.add(os.path.join(IMAGES, target))
            targets.add(os.path.join(DATA, target))
        else:
            targets.add(target)

    # iterate over all visible refs (mostly branches)
    # this hinges on being in the top level directory of the the git checkout
    with remember_cwd():
        os.chdir(os.path.join(BASE, ".."))
        refs = get_refs()
        # list images present in each branch
        for name, ref in refs.items():
            sys.stderr.write("Considering images from {0} ({1})\n".format(name, ref))
            for link in get_image_links(ref):
                maybe_add_target(link)
                maybe_add_target(link + ".xz")

    # what we have in the current checkout might already have been added by its branch, but check anyway
    for filename in os.listdir(IMAGES):
        path = os.path.join(IMAGES, filename)

        # only consider original image entries as trustworthy sources and ignore non-links
        if path.endswith(".xz") or path.endswith(".qcow2") or path.endswith(".partial") or not os.path.islink(path):
            continue

        target = os.readlink(path)
        maybe_add_target(target)
        maybe_add_target(target + ".xz")

    expiry_threshold = now - testinfra.IMAGE_EXPIRE * 86400
    for filename in os.listdir(DATA):
        path = os.path.join(DATA, filename)
        if not force and (enough_disk_space() and os.lstat(path).st_mtime > expiry_threshold):
            continue
        if os.path.isfile(path) and (path.endswith(".xz") or path.endswith(".qcow2") or path.endswith(".partial")) and path not in targets:
            sys.stderr.write("Pruning {0}\n".format(filename))
            if not dryrun:
                os.unlink(path)

    # now prune broken links
    for filename in os.listdir(IMAGES):
        path = os.path.join(IMAGES, filename)

        # don't prune original image entries and ignore non-links
        if not path.endswith(".qcow2") or not os.path.islink(path):
            continue

        # if the link isn't valid, prune
        if not os.path.isfile(path):
            sys.stderr.write("Pruning link {0}\n".format(path))
            if not dryrun:
                os.unlink(path)

def every_image():
    result = []
    for filename in os.listdir(IMAGES):
        link = os.path.join(IMAGES, filename)
        if os.path.islink(link):
            result.append(filename)
    return result

def download_images(image_list, force, store):
    for image in image_list:
        link = os.path.join(IMAGES, image)
        if not os.path.islink(link):
            raise Exception("image link does not exist: " + image)
        download(link, force, store)
