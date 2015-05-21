#!/usr/bin/python
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2015 Red Hat, Inc.
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

import contextlib
import datetime
import libvirt
from   lxml import etree
import virtdeploy
import os
import socket
import subprocess
import sys
import time

###############################################################################
# setup script parameters

verbose = os.getenv('VERBOSE', False)
if verbose is '0':
    verbose = False
verbose = True
def echo_colored(msg, always_show = False, color = 0):
    if verbose or always_show:
        print "[%s] \x1b[%dm%s\x1b[0m" % (datetime.datetime.now().isoformat(), color, msg);

def echo_log(msg, always_show = False):
    echo_colored(msg, always_show = always_show)

def echo_error(msg, always_show = False):
    echo_colored(msg, always_show = always_show, color = 31)

def echo_warning(msg, always_show = False):
    echo_colored(msg, always_show = always_show, color = 33)

def echo_success(msg, always_show = False):
    echo_colored(msg, always_show = always_show, color = 32)

script_dir = os.path.dirname(os.path.abspath(__file__))

# attach this prefix and suffix to machine names
# this can be changed to avoid conflicts with other scripts running in the same environment
machine_prefix = os.getenv('MACHINE_PREFIX', 'machine')
machine_suffix = os.getenv('MACHINE_SUFFIX', '7')

# all machines will be on this network
# if network doesn't exist, it will be created
network_name = os.getenv('HOST_NETWORK', 'cockpitx')
network_ip_extension = os.getenv('HOST_NETWORK_IP_EXTENSION', '123')

pool_name = os.getenv('HOST_POOL', 'cockpitx')
pool_path = os.getenv('HOST_POOL_PATH', "/home/%s" % pool_name)

guest_os = os.getenv('GUEST_OS', 'fedora-21')
guest_arch = os.getenv('GUEST_ARCH', 'x86_64')

machine_name = "%s-%s" % (machine_prefix, machine_suffix)
guest_name = "%s-%s-%s" % (machine_name, guest_os, guest_arch)

snapshot_name_initialized = "initialized"

def state_initialized_filename(gst = guest_name,snapinit=snapshot_name_initialized):
    actfile=[foo for foo in os.listdir(pool_path) if gst in foo and snapinit in foo]
    if actfile:
        ret=os.path.join(pool_path, actfile[0])
    else:
        ret = os.path.join(pool_path, "%s_%s" % (gst, snapinit))
    return ret

machine_root_pass = os.getenv('GUEST_PASS', 'testvm')

hostkey = os.getenv('HOSTKEY', os.path.join(script_dir, 'keys/host_key'))
userkey = os.getenv('USERKEY', os.path.join(script_dir, 'keys/identity'))

os.chmod(hostkey, 0600)
os.chmod(userkey, 0600)

ssh_options = ['-o', 'UserKnownHostsFile=/dev/null',
               '-o', 'StrictHostKeyChecking=no',
               '-o', 'ConnectTimeout=30'
              ]

virt = virtdeploy.get_driver('libvirt')

clean = os.getenv('CLEAN', False)
if clean is '0':
    clean = False

if clean:
    echo_log('Cleaning up.')

# cleaning the pool requires extra confirmation, since it can delete lots of data
clean_pool = os.getenv('CLEAN_POOL', False)

# identify the package manager to use in guest
def guest_pkg_mngr(guest_os):
    guest_package_manager = 'yum'
    if guest_os is 'fedora-22':
        guest_package_manager = 'dnf'
    elif 'debian' in guest_os:
        echo_log('Debian currently not supported')
    raise
    return guest_package_manager

# based on http://stackoverflow.com/a/17753573
# we use this to quieten down libvirt calls
@contextlib.contextmanager
def stdchannel_redirected(stdchannel, dest_filename):
    """
    A context manager to temporarily redirect stdout or stderr
    e.g.:
    with stdchannel_redirected(sys.stderr, os.devnull):
        noisy_function()
    """
    try:
        oldstdchannel = os.dup(stdchannel.fileno())
        dest_file = open(dest_filename, 'w')
        os.dup2(dest_file.fileno(), stdchannel.fileno())
        yield
    finally:
        if oldstdchannel is not None:
            os.dup2(oldstdchannel, stdchannel.fileno())
        if dest_file is not None:
            dest_file.close()

def get_ip(dom):
    """
    Get the first ip for a given virDomain object
    Function interfaceAddresses available in libvirt-python starting 1.2.14,
    for now use virt-deploy

    """
    addresses = virt.instance_address(dom.name())
    if addresses and len(addresses) > 0:
        return addresses[0]
    echo_log("unable to get address for machine %s" % dom.name())
    raise

def wait_ssh(address):
    """
    Try to connect to machine on port 22
    """
    tries_left = 30
    while (tries_left > 0):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        try:
            sock.connect((address, 22))
            return True
        except:
            pass
        finally:
            sock.close()
        tries_left = tries_left - 1
        time.sleep(1)
    return False

def upload(address, sources, dest):
    """Upload a file into the test machine

    Arguments:
        sources: the array of paths of the file to upload
        dest: the file path in the machine to upload to
    """
    assert sources and dest
    assert address
    try:
        realaddr = get_ip(refresh_guest(address))
    except:
        realaddr = address
        pass
    if isinstance(sources, basestring):
        sources = [sources]
    cmd = [
        "scp",
        "-i", userkey
    ] + ssh_options + sources + [ "root@%s:%s" % (realaddr, dest), ]

    subprocess.check_call(cmd)

def download(address, source, dest):
    """Download a files from the test machine

    Arguments:
        sources: path or file to upload
        dest: the file path in the machine to upload to
    """
    assert sources and dest
    assert address
    try:
        realaddr = get_ip(address)
    except:
        realaddr = address
        pass
    cmd = [
        "scp",
        "-r",
        "-i", userkey
    ] + ssh_options  + [ "root@%s:%s" % (realaddr, source), dest]

    subprocess.check_call(cmd)


###############################################################################
# make sure we can connect to libvirt

conn = libvirt.open('qemu:///system')

if not conn:
    echo_error('Failed to open connection to the hypervisor', always_show = True)
    sys.exit(1)

###############################################################################
# get network info

def create_network(conn):
    net_def = """<network>
  <name>%(name)s</name>
  <domain name='cockpit.lan' localOnly='yes'/>
  <forward mode='nat'/>
  <bridge name='%(name)s' stp='on' delay='0'/>
  <mac address='52:54:00:AB:AB:AB'/>
  <ip address='192.168.%(extension)s.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.168.%(extension)s.2' end='192.168.%(extension)s.254'/>
    </dhcp>
  </ip>
</network>
""" % { 'name': network_name, 'extension': network_ip_extension }
    net = conn.networkDefineXML(net_def)
    net.setAutostart(True)
    return net

def delete_network(net):
    if not net:
        return
    try:
        net.destroy()
    except:
        pass
    try:
        net.undefine()
    except:
        pass

net = None
try:
    with stdchannel_redirected(sys.stderr, os.devnull):
        net = conn.networkLookupByName(network_name)
except:
    pass

###############################################################################
# get pool info

def create_pool(conn):
    pool_def = """
<pool type='dir'>
  <name>%(name)s</name>
  <target>
    <path>%(path)s</path>
  </target>
</pool>
""" % { 'name': pool_name, 'path': pool_path }
    pool = conn.storagePoolDefineXML(pool_def)
    pool.setAutostart(True)
    return pool

def delete_pool(pool):
    if not pool:
        return
    try:
        pool.delete()
        pool.destroy()
    except:
        pass
    try:
        pool.undefine()
    except:
        pass

pool = None
try:
    with stdchannel_redirected(sys.stderr, os.devnull):
        pool = conn.storagePoolLookupByName(pool_name)
except:
    pass

###############################################################################
# get guest info

def install_keys(dom):
    """
    Install keyfiles on domain (identity and hostkey)
    This enables future authentication via ssh key
    """
    ip = get_ip(dom)
    if not wait_ssh(ip):
        echo_log("Timed out waiting for machine %s to start" % dom.name())
        raise

    # install ssh key first
    env = os.environ.copy()
    env['SSHPASS'] = machine_root_pass
    args = ['sshpass', '-e', 'ssh'] + ssh_options + ["%s@%s" % ('root', ip)] + ['mkdir', '-p', '-m', '0700', '/root/.ssh']
    subprocess.check_call(args, env = env)

    args = ['sshpass', '-e', 'scp'] + ssh_options + [userkey + '.pub', "%s@%s:/root/.ssh/authorized_keys" % ('root', ip)]
    subprocess.check_call(args, env = env)

    # now update hostykey
    upload(ip, hostkey, '/etc/ssh/ssh_host_rsa_key')
    args = ['ssh', '-i', userkey] + ssh_options + ["%s@%s" % ('root', ip)] + ['umask', '0600', '/etc/ssh/ssh_host_rsa_key']
    subprocess.check_call(args)
    upload(ip, hostkey + '.pub', '/etc/ssh/ssh_host_rsa_key.pub')

def refresh_guest(gst=guest_name):
    g = None
    try:
        with stdchannel_redirected(sys.stderr, os.devnull):
            g = conn.lookupByName(gst)
    except libvirt.libvirtError:
        pass
    if  g is None:
        try:
            for dom in conn.listAllDomains():
                if gst in dom.name():
                    g=dom
                    break
        except libvirt.libvirtError:
            pass
    
    return g

def create_guest(conn,local_guest_name=guest_name,local_guest_os_version=guest_os):
    # make sure old volume doesn't exist
    vol = None
    try:
        with stdchannel_redirected(sys.stderr, os.devnull):
            localvol=state_initialized_filename(local_guest_name,".qcow2")
            vol = pool.storageVolLookupByName(localvol)
    except libvirt.libvirtError as ex:
        # This could be an issue if a domain was undefined and we have a leftover file
        if ex.message.startswith('Storage volume not found'):
            vol_file = state_initialized_filename(local_guest_name,".qcow2")
            if os.path.isfile(vol_file):
                os.remove(vol_file)
                echo_warning("Workaround: deleted file '%s'" % (vol_file), always_show = True)
            else:
                echo_warning("path not found: %s" % (vol_file))
                echo_warning("try calling CLEAN")
                echo_error(ex, always_show = True)
        else:
            echo_error(ex, always_show = True)
            exit(1)
    if vol:
        try:
            vol.delete()
        except libvirt.libvirtError as ex:
            echo_error(ex, always_show = True)
            exit(1)
    try:
        with stdchannel_redirected(sys.stdout, os.devnull):
            instance = virt.instance_create(
                local_guest_name,
                local_guest_os_version,
                arch = guest_arch,
                network = network_name,
                pool = pool_name,
                password = machine_root_pass
            )
    except ex:
        echo_warning(ex, always_show = True)

    if (local_guest_name in instance['name']):
        echo_log("Expected guest name to be '%s', got: '%s'" % (local_guest_name, instance['name']), always_show = True)

    dom = conn.lookupByName(instance['name'])
    if not dom.isActive():
        dom.create()

    echo_log("install ssh keyfiles")
    with stdchannel_redirected(sys.stdout, os.devnull):
        with stdchannel_redirected(sys.stderr, os.devnull):
            install_keys(dom)

    # make sure we have a fresh boot
    ip = get_ip(dom)

    with stdchannel_redirected(sys.stderr, os.devnull):
        args = ['ssh', '-i', userkey] + ssh_options + ["%s@%s" % ('root', ip)] + ['poweroff']
        subprocess.call(args)

    while dom.isActive():
        time.sleep(1)

    # now start again
    dom.create()

    if not wait_ssh(ip):
        echo_error("Timed out waiting for machine %s to start" % dom.name(), always_show = True)
        exit(1)
    
    echo_log("save to disk")
    dom.save(state_initialized_filename(local_guest_name))

def delete_guest(guest):
    if not guest:
        return
    virt.instance_delete(guest_name)


def guest_snapshot_create(dom, name):
    # save snapshot
    snapshot_desc = """
<domainsnapshot>
  <name>%s</name>
  <description>Bare system</description>
</domainsnapshot>
""" % name
    echo_log("create snapshot '%s'" % name)
    dom.snapshotCreateXML(snapshot_desc)

###############################################################################
# if cleaning, remove everything and quit

#if clean:
#    delete_guest(guest)
#    delete_network(net)
#    if clean_pool:
#        delete_pool(pool)
#    sys.exit(0)

def sys_setup():
    ###############################################################################
    # create/start pool if necessary
    pool=None
    try:
        with stdchannel_redirected(sys.stderr, os.devnull):
            pool = conn.storagePoolLookupByName(pool_name)
    except:
        pass
    if not pool:
        pool = create_pool(conn)

    if not pool.isActive():
        pool.create()

    ###############################################################################
    # create/start network if necessary
    net = None
    try:
        with stdchannel_redirected(sys.stderr, os.devnull):
            net = conn.networkLookupByName(network_name)
    except:
        pass
    if not net:
        net = create_network(conn)
    
    if not net.isActive():
        net.create()

###############################################################################
# create/start guest if necessary

# if we don't have a saved state, then recreate
def spawn_guest(local_guest_name,distro=guest_os):
    guest = refresh_guest(local_guest_name)
    if not guest or not os.path.isfile(state_initialized_filename(local_guest_name)):
        if guest and guest.isActive():
            guest.destroy()
#        try:
        echo_log("creating new guest")
        create_guest(conn,local_guest_name,distro)
        guest = refresh_guest(local_guest_name)
#        except ex:
#        echo_error(str(ex), always_show = True)
#        echo_error("Creating guest machine failed. Try cleaning (CLEAN=1) first.", always_show = True)
#        exit(1)
        echo_success("created guest", always_show = True)

    # make sure we aren't running in the beginning
    if guest.isActive():
        guest.destroy()

    # make sure we have no snapshots
    for snap in guest.listAllSnapshots():
        snap.delete()

    echo_log("restoring initial state")
    if conn.restore(state_initialized_filename(local_guest_name)) != 0:
        echo_log("unable to restore machine from '%s'" % state_initialized_filename(local_guest_name))
        raise Exception("unable to restore machine from '%s'" % state_initialized_filename(local_guest_name))
    guest = refresh_guest(local_guest_name)
    if not guest:
        echo_log("unable to restore machine from '%s'" % state_initialized_filename(local_guest_name))
        raise Exception("unable to restore machine from '%s'" % state_initialized_filename(local_guest_name))
    #guest.resume()

    echo_log("reboot")
    guest.reset()
    time.sleep(1)

    if not wait_ssh(get_ip(guest)):
        echo_error("Timed out waiting for machine %s to start" % guest.name(), always_show = True)
        exit(1)

    echo_log("create initial snapshot")

def snap_guest(dom):
    guest_snapshot_create(dom, snapshot_name_initialized)
    return dom.snapshotLookupByName(snapshot_name_initialized)

def guest_run_command(dom, command, errors=False):
    """
    Execute a command in the shell via ssh
    """
    ip = get_ip(dom)
    if not wait_ssh(ip):
        echo_error("Timed out waiting for machine %s to start" % dom.name(), always_show = True)
        exit(1)

    args = ['ssh', '-i', userkey] + ssh_options + ["%s@%s" % ('root', ip), command]
    if errors:
        return subprocess.check_output(args)
    else:
        with stdchannel_redirected(sys.stderr, os.devnull):
            return subprocess.check_output(args)

def test_func(local_guest_name):
    """
    Create a file on the target machine and read that back
    then revert machine and ensure it's gone
    """
    dom=refresh_guest(local_guest_name)
    test_filename = '~/testfile'
    guest_run_command(dom, "echo 'foobar' > %s" % test_filename)
    output = guest_run_command(dom, "cat %s" % test_filename)
    if not 'foobar' in output:
        echo_error("unable to read test file on guest", always_show = True)
        exit(1)
    # now revert
    dom.revertToSnapshot(snap_guest(dom))
    # try to read again
    try:
        output = guest_run_command(dom, "cat %s" % test_filename)
    except:
        output = ''
        pass
    if 'foobar' in output:
        echo_error("revert failed", always_show = True)

def guest_favour(local_guest_name,flavor_script_path,varfile=""):
    dom=refresh_guest(local_guest_name)
    flavorname=os.path.basename(flavor_script_path)
    ip = get_ip(dom)
    if not wait_ssh(ip):
        echo_log("Timed out waiting for machine %s to start" % dom.name())
        raise

    upload(ip, flavor_script_path, '/var/tmp/%s' % flavorname)
    guest_run_command(dom, 'chmod a+x /var/tmp/%s' % flavorname, True)
    guest_run_command(dom, '/var/tmp/%s "%s"' % (flavorname, varfile), True)

avocado="avocado run -xunit"

def avocado_run(local_guest_name,test_name_paths,multiplex_file=None):
    dom=refresh_guest(local_guest_name)
    ip = get_ip(dom)
    if not wait_ssh(ip):
        echo_log("Timed out waiting for machine %s to start" % dom.name())
        raise
    tests = test_name_paths
    if isinstance(test_name_paths, list):
         tests = ' '.join(test_name_paths)
    guest_run_command(dom, 'mkdir -p /var/tmp/avocado')
    upload(ip, test_name_paths, '/var/tmp/avocado/')
    guest_run_command(dom, 'chmod a+x /var/tmp/avocado/*')
    if multiplex_file:
        guest_run_command(dom, '%s -multiplex %s /var/tmp/avocado/%s' % (avocado, multiplex_file, tests))
    else:
        guest_run_command(dom, '%s /var/tmp/avocado/%s' % (avocado, tests))
    download(ip,'/root/avocado', './')
    