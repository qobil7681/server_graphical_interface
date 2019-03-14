from testlib_avocado.seleniumlib import clickable, visible, invisible, text_in
from testlib_avocado.machineslib import MachinesLib
from time import sleep
import time


class MachinesDisksTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines_d
    """

    def prepare_disk(self):
        pool_a = 'apool{}'.format(str(time.time()).split('.')[0])
        pool_m = 'mypool{}'.format(str(time.time()).split('.')[0])
        self.log.info(pool_a,type(pool_a))
        self.log.info(pool_m,type(pool_m))
        self.machine.execute('sudo mkdir /home/{}'.format(pool_a))
        self.machine.execute('sudo virsh pool-create-as {} --type dir --target /home/{}'.format(pool_a,pool_a))
        self.machine.execute('sudo mkdir /home/{}'.format(pool_m))
        self.machine.execute('sudo virsh pool-create-as {} --type dir --target /home/{}'.format(pool_m,pool_m))

        self.storage_pool[pool_a] = []
        self.storage_pool[pool_m] = []
        self.machine.execute('sudo virsh vol-create-as {} {} --capacity 1G --format qcow2'.format(pool_a, 'apooldisk1'))
        self.storage_pool[pool_a].append('apooldisk1')
        self.machine.execute('sudo virsh vol-create-as {} {} --capacity 1G --format qcow2'.format(pool_a, 'apooldisk2'))
        self.storage_pool[pool_a].append('apooldisk2')
        self.machine.execute('sudo virsh vol-create-as {} {} --capacity 1G --format qcow2'.format(pool_m, 'mypooldisk1'))
        self.storage_pool[pool_m].append('mypooldisk1')
        self.machine.execute('sudo virsh vol-create-as {} {} --capacity 1G --format qcow2'.format(pool_m, 'mypooldisk2'))
        self.storage_pool[pool_m].append('mypooldisk2')

        return (pool_a,pool_m)

    def testDiskInfo(self):
        name = "staticvm"
        args = self.create_vm(name)

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-hda-device'.format(name), cond=text_in, text_='disk')
        self.wait_css('#vm-{}-disks-hda-bus'.format(name), cond=text_in, text_='ide')
        self.wait_css('#vm-{}-disks-hda-source .machines-disks-source-value'.format(name), 
                       cond=text_in, text_='{}'.format(args.get('image')))
        self.wait_css('#vm-{}-disks-hda-used'.format(name), cond=text_in, text_='0.02')
        self.wait_css('#vm-{}-disks-hda-capacity'.format(name), cond=text_in, text_='0.04')

    def testAddDiskWithVmOff(self):
        name = "staticvm"
        self.create_vm(name, state='shut off')
        pool_name = self.prepare_disk()

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name)), 'qcow2disk')
        self.storage_pool[pool_name[0]].append('qcow2disk')
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vda-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name), cond=visible), 'raw2disk')
        self.storage_pool[pool_name[0]].append('raw2disk')
        self.click(self.wait_css('#vm-{}-disks-adddisk-new-diskfileformat > button'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-new-diskfileformat > ul > li:nth-child(2) > a'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdb-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-useexisting'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name, cond=clickable)))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdc-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-useexisting'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-existing-select-pool button'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-existing-select-pool > ul > li:nth-child(3) > a'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-existing-select-volume > button'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-existing-select-volume > ul > li:nth-child(2) > a'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name, cond=clickable)))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdd-device'.format(name))

        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-run'.format(name), cond=invisible)

        self.assertEqual(self.machine.execute("sudo virsh list --all | grep staticvm | awk '{print $3}' ORS=''"), 'running')
        self.assertEqual(int(self.machine.execute('sudo virsh domblklist {} | wc -l'.format(name))), 8)

    def testAddDiskWithVmOn(self):
        name = "staticvm"
        self.create_vm(name, wait=True)
        pool_name = self.prepare_disk()

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name), cond=visible), 'qcow2disk')
        self.storage_pool[pool_name[0]].append('qcow2disk')
        self.check_box(self.wait_css('#vm-{}-disks-adddisk-new-permanent'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vda-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name), cond=visible), 'raw2disk')
        self.storage_pool[pool_name[0]].append('raw2disk')
        self.click(self.wait_css('#vm-{}-disks-adddisk-new-diskfileformat > button'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-new-diskfileformat > ul > li:nth-child(2) > a'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdb-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-useexisting'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name, cond=clickable)))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdc-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-useexisting'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-existing-select-pool button'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-existing-select-pool > ul > li:nth-child(3) > a'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-existing-select-volume > button'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-existing-select-volume > ul > li:nth-child(2) > a'.format(name), cond=clickable))
        self.check_box(self.wait_css('#vm-{}-disks-adddisk-existing-permanent'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name, cond=clickable)))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdd-device'.format(name))

        self.click(self.wait_css('#vm-{}-off'.format(name), cond=clickable))
        self.wait_css('#vm-{}-off'.format(name), cond=invisible)

        self.assertEqual(
            self.wait_css('#vm-staticvm-disks-vda-source > tbody > tr:nth-child(2) > td:nth-child(2)', cond=visible).text,
            'qcow2disk')
        self.assertEqual(
            self.wait_css('#vm-staticvm-disks-vdd-source > tbody > tr:nth-child(2) > td:nth-child(2)', cond=visible).text,
            'mypooldisk2')
        self.assertEqual(self.machine.execute("sudo virsh list --all | grep staticvm | awk '{print $3}' ORS=''"), 'shut')
        self.assertEqual(int(self.machine.execute('sudo virsh domblklist {} | wc -l'.format(name))), 6)

    def testDetachDiskVmOn(self):
        name = "staticvm"
        self.create_vm(name, wait=True)

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name), cond=visible), 'detachdisk')
        self.storage_pool['detachdisk'] = 'disk'
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-vda-device'.format(name))
        self.click(self.wait_css('#vm-{}-disks-vda-detach'.format(name), cond=clickable))
        self.wait_css('vm-{}-disks-vda-device'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-off'.format(name), cond=clickable))
        self.wait_css('#vm-{}-off'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-run'.format(name), cond=invisible)
        self.wait_css('vm-{}-disks-vda-device'.format(name), cond=invisible)

        self.assertEqual(int(self.machine.execute('sudo virsh domblklist {} | wc -l'.format(name))), 4)

    def testDetachDiskVmOff(self):
        name = "staticvm"
        self.create_vm(name, state='shut off')

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name), cond=visible), 'detachdisk')
        self.storage_pool['detachdisk'] = 'disk'
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-vda-device'.format(name))
        self.click(self.wait_css('#vm-{}-disks-vda-detach'.format(name), cond=clickable))
        self.wait_css('vm-{}-disks-vda-device'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-run'.format(name), cond=invisible)
        self.wait_css('vm-{}-disks-vda-device'.format(name), cond=invisible)

        self.assertEqual(int(self.machine.execute('sudo virsh domblklist {} | wc -l'.format(name))), 4)
