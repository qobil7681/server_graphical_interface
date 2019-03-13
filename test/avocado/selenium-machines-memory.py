from testlib_avocado.machineslib import MachinesLib
from testlib_avocado.seleniumlib import visible, clickable


class MachinesMemoryTestSuite(MachinesLib):
    '''
    :avocado: enable
    :avocado: tags=machines
    '''

    def testMemUsageOff(self):
        self.create_vm(state='shut off')

        self.click(self.wait_css('#vm-staticvm-usage', cond=clickable))
        self.assertEqual(self.wait_css(
            '#chart-donut-0 .donut-title-big-pf', cond=visible).text, '0.00')

    def testMemUsageRunning(self):
        self.create_vm()

        self.click(self.wait_css('#vm-staticvm-usage', cond=clickable))
        self.assertNotEqual(self.wait_css(
            '#chart-donut-0 .donut-title-big-pf', cond=visible), "0.00")
