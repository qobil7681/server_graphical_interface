#!/usr/bin/python
""" SETUP tasks

# workaround for RHEL7
# curl https://copr.fedoraproject.org/coprs/lmr/Autotest/repo/epel-7/lmr-Autotest-epel-7.repo > /etc/yum.repos.d/lmr-Autotest-epel-7.repo
# yum --nogpgcheck -y install python-pip
# pip install selenium
yum --nogpgcheck -y install avocado python-selenium

adduser test
echo superhardpasswordtest5554 | passwd --stdin test
usermod -a -G wheel test

# in case of you would like to use selenium server in docker:
docker run -d -p 4444:4444 --name selenium-hub selenium/hub:2.48.2
docker run -d --link selenium-hub:hub selenium/node-chrome:2.48.2
docker run -d --link selenium-hub:hub selenium/node-firefox:2.48.2

systemctl start cockpit

# RUN AS
avocado run selenium-login.py
# OR ALTERNATIVELY with docker selenium server (BROWSER=firefox or chrome)
HUB=localhost BROWSER=chrome GUEST=`hostname -i` avocado run selenium-login.py


"""

from avocado import Test
from avocado import main
from avocado.utils import process
import inspect
import selenium.webdriver
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
import os
import sys
import re
import time
machine_test_dir = os.path.dirname(os.path.abspath(inspect.getfile(inspect.currentframe())))
sys.path.append(machine_test_dir)
import libdisc

user = "test"
passwd = "superhardpasswordtest5554"


class BasicTestSuite(Test):

    def __init__(self, *args, **kwargs):
        super(BasicTestSuite, self).__init__(*args, **kwargs)

    def setUp(self):
        if not (os.environ.has_key("HUB") or os.environ.has_key("BROWSER")):
            self.driver = selenium.webdriver.Firefox()
            guest_machine = 'localhost'
        else:
            selenium_hub = os.environ["HUB"] if os.environ.has_key("HUB") else "localhost"
            browser = os.environ["BROWSER"] if os.environ.has_key("BROWSER") else "firefox"
            guest_machine = os.environ["GUEST"]
            self.driver = selenium.webdriver.Remote(
                command_executor='http://%s:4444/wd/hub' % selenium_hub, desired_capabilities={'browserName': browser})

        self.driver.set_window_size(1400, 1200)
        self.driver.set_page_load_timeout(90)
        self.driver.implicitly_wait(1)
        self.default_try = 30
        self.default_sleep = 1
        self.driver.get('http://%s:9090' % guest_machine)

    def tearDown(self):
        pass
        self.driver.close()
        self.driver.quit()

    def wait(self, method, text, overridetry, fatal):
        returned = None
        #time.sleep(self.default_sleep)
        internaltry = overridetry if overridetry else self.default_try
        for foo in range(0, internaltry):
            try:
                returned = method(text)
                break
            except:
                print "REP>", foo
                time.sleep(self.default_sleep)
                pass
        if returned is None:
            if fatal:
                screenshot_file="snapshot-%s-%s-lines_%s.png" % (str(inspect.stack()[1][3]), str(inspect.stack()[2][3]), '-'.join([str(x[2]) for x in inspect.stack() if inspect.stack()[0][1] == x[1] ]))
                self.driver.get_screenshot_as_file(screenshot_file)
                print  screenshot_file
                raise Exception('ERR: Unable to locate name: %s' % str(text), screenshot_file)
            else:
                return None
        return method(text)

    def wait_id(self, el, baseelement=None, overridetry=None, fatal=True):
        if not baseelement:
            baseelement = self.driver
        return self.wait(baseelement.find_element_by_id, el, overridetry=overridetry, fatal=fatal)

    def wait_link(self, el, baseelement=None, overridetry=None, fatal=True):
        if not baseelement:
            baseelement = self.driver
        return self.wait(baseelement.find_element_by_partial_link_text, el, overridetry=overridetry, fatal=fatal)

    def wait_xpath(self, el, baseelement=None, overridetry=None, fatal=True):
        if not baseelement:
            baseelement = self.driver
        return self.wait(baseelement.find_element_by_xpath, el, overridetry=overridetry, fatal=fatal)

    def wait_iframe(self, el, baseelement=None, overridetry=None, fatal=True):
        if not baseelement:
            baseelement = self.driver
        out = None
        self.wait_xpath("//iframe", baseelement, overridetry=overridetry, fatal=fatal)
        iframes = self.wait(baseelement.find_elements_by_xpath, "//iframe", overridetry=overridetry, fatal=fatal)
        if len(iframes) == 0:
            raise Exception('There is no iframe, but SHOULD be')
        elif len(iframes) == 1:
            out = [x for x in iframes][0]
        else:
            for frame in iframes:
                if el in str(frame.get_attribute("name")):
                    out = frame
            for frame in iframes:
                if "shell" in str(frame.get_attribute("name")):
                    out = frame
        print out
        return out

    def mainframe(self):
        self.driver.switch_to_default_content()

    def selectframe(self, framename, baseelement=None):
        if not baseelement:
            baseelement = self.driver
        baseelement.switch_to_frame(self.wait_iframe(framename))

    def login(self, tmpuser=user, tmppasswd=passwd):
        elem = self.wait_id('login-user-input')
        elem.clear()
        elem.send_keys(tmpuser)
        elem = self.wait_id('login-password-input')
        elem.clear()
        elem.send_keys(tmppasswd)
        self.wait_id("login-button").click()
        return elem

    def logout(self):
        elem = self.wait_id('navbar-dropdown')
        elem.click()
        elem = self.wait_id('go-logout')
        elem.click()

    def test10Base(self):
        elem = self.wait_id('server-name')
        out = process.run("hostname", shell=True)
        self.assertTrue(str(out.stdout)[:-1] in str(elem.text))

    def test20Login(self):
        elem = self.login()
        self.wait_iframe("system")
        elem = self.wait_id("content-user-name")
        self.assertEqual(elem.text, user)

        self.logout()
        elem = self.wait_id('server-name')

        elem = self.login("baduser", "badpasswd")
        elem = self.wait_xpath(
            "//*[@id='login-error-message' and @style='display: block;']")
        print elem.text
        self.assertTrue("Wrong" in elem.text)

        elem = self.login()
        self.wait_iframe("system")
        elem = self.wait_id("content-user-name")
        self.assertEqual(elem.text, user)

    def test30ChangeTabServices(self):
        self.login()
        self.wait_iframe("system")
        self.wait_link('Services').click()
        self.selectframe("services")

        elem = self.wait_xpath("//*[contains(text(), '%s')]" % "Socket")
        elem.click()
        self.wait_xpath("//*[contains(text(), '%s')]" % "udev")

        elem = self.wait_xpath("//*[contains(text(), '%s')]" % "Target")
        elem.click()
        self.wait_xpath("//*[contains(text(), '%s')]" % "reboot.target")

        elem = self.wait_xpath(
            "//*[contains(text(), '%s')]" % "System Services")
        elem.click()
        self.wait_xpath("//*[contains(text(), '%s')]" % "dbus.service")

        self.mainframe()
        
    def test40ContainerTab(self):
        self.login()
        self.wait_iframe("system")
        self.wait_link('Containers').click()
        self.selectframe("docker")
        time.sleep(3)
        elem = self.wait_id('curtain')
        if "display: block;" in str(elem.get_attribute("style")):
            elem = self.wait_xpath("//*[@data-action='docker-start']")
            elem.click()
        elem = self.wait_xpath(
            "//*[@id='containers' and @style='display: block;']")
        self.wait_id('containers-storage')
        self.wait_id('containers-images-search').click()
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-dialog' and @class='modal in']")
        baseelem = elem
        elem = self.wait_id('containers-search-image-search',baseelem)
        elem.clear()
        elem.send_keys("fedora")
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-results' and @style='display: block;']")
        elem = self.wait_xpath(
            "//*[contains(text(), '%s')]" % "Official Docker")
        elem = self.wait_xpath(
            "//div[@id='containers-search-image-dialog']//button[contains(text(), '%s')]" % "Cancel")
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-dialog' and @style='display: none;']")

        self.wait_id('containers-images-search').click()
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-dialog' and @class='modal in']")
        baseelem = elem
        elem = self.wait_id('containers-search-image-search',baseelem)
        elem.clear()
        elem.send_keys("cockpit")
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-results' and @style='display: block;']")
        elem = self.wait_xpath(
            "//*[contains(text(), '%s')]" % "Cockpit Web Ser")
        elem.click()
        elem = self.wait_id('containers-search-download', baseelem)
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-dialog' and @style='display: none;']")
        elem = self.wait_xpath(
            "//*[@class='container-col-tags' and contains(text(), 'cockpit/ws')]")

        self.mainframe()

    def test50ChangeTabLogs(self):
        self.login()
        self.wait_iframe("system")
        self.wait_link('Logs').click()
        self.selectframe("logs")
        elem = self.wait_xpath("//button[contains(text(), 'Errors')]")
        elem.click()
        elem = self.wait_xpath("//button[contains(text(), 'Warnings')]")
        elem.click()
        elem = self.wait_xpath("//button[contains(text(), 'Notices')]")
        elem.click()
        checkt="ahoj notice"
        out=process.run("systemd-cat -p notice echo '%s'" % checkt, shell=True)
        elem = self.wait_xpath(
            "//*[@class='cockpit-log-message' and contains(text(), '%s')]" % checkt)
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='journal-entry' and @style='display: block;']")
        self.mainframe()

    def test60ChangeTabStorage(self):
        reald_name = process.run(
            "storagedctl status | tail -1 |sed -r 's/.* ([a-z]+).*/\\1/'", shell=True).stdout[:-1]
        reald_serial = process.run(
            "storagedctl status | tail -1 |sed -r 's/.* ([^ ]+)\s+[a-z]+.*/\\1/'", shell=True).stdout[:-1]
        print ">>>" + reald_name + ">>>" + reald_serial + ">>>"
        other_disc=libdisc.DiscSimple()
        other_discname=other_disc.adddisc("d1")
        other_shortname=os.path.basename(other_discname)
        self.login()
        self.wait_iframe("system")
        self.wait_link('Storage').click()
        self.selectframe("storage")
        elem = self.wait_id("drives")
        elem = self.wait_xpath("//*[@data-goto-block='%s']" % other_shortname)
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='storage-detail' and @style='display: block;']")
        basel = elem
        self.wait_xpath("//*[contains(text(), '%s')]" % "Capacity")
        self.wait_xpath("//*[contains(text(), '%s')]" % "1000 MB")

        self.wait_link('Storage', basel).click()
        elem = self.wait_xpath("//*[@data-goto-block='%s']" % other_shortname)

        self.mainframe()

    def test70ChangeTabNetworking(self):
        self.login()
        self.wait_iframe("system")
        out = process.run(
            "ip r |grep default | head -1 | cut -d ' ' -f 5", shell=True)
        self.wait_link('Network').click()
        self.selectframe("network")

        self.wait_id("networking-interfaces")
        self.wait_id("networking-tx-graph")

        elem = self.wait_xpath("//*[contains(text(), '%s')]" % out.stdout[:-1])
        self.mainframe()

    def test80ChangeTabTools(self):
        self.login()
        self.wait_iframe("system")
        elem = self.wait_link('Tools')
        self.assertEqual(elem.get_attribute('class'), "collapsed")
        elem.click()
        time.sleep(1)
        elem = self.wait_link('Tools')
        self.assertEqual(elem.get_attribute('class'), "")
        elem.click()
        time.sleep(1)
        elem = self.wait_link('Tools')
        self.assertEqual(elem.get_attribute('class'), "collapsed")
        elem.click()
        time.sleep(1)

        self.wait_link('Accounts').click()
        self.selectframe("users")
        elem = self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % user)
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='account' and @style='display: block;']")
        self.wait_xpath("//*[contains(text(), '%s')]" % "Full Name")
        self.wait_link('Accounts', elem).click()
        self.wait_id('accounts-create').click()
        elem = self.wait_id('accounts-create-real-name')
        elem.clear()
        elem.send_keys('testxx')
        elem = self.wait_id('accounts-create-pw1')
        elem.clear()
        elem.send_keys(passwd)
        elem = self.wait_id('accounts-create-pw2')
        elem.clear()
        elem.send_keys(passwd)
        self.wait_id('accounts-create-create').click()
        elem = self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % 'testxx')
        elem.click()
        self.wait_id('account-delete').click()
        elem = self.wait_xpath(
            "//*[@id='account-confirm-delete-dialog' and @style='display: block;']")
        self.wait_id('account-confirm-delete-apply').click()
        time.sleep(2)
        self.mainframe()

        self.wait_link('Terminal').click()
        self.selectframe("terminal")
        self.wait_xpath("//div[@id='terminal']")
        elem = self.wait_xpath("//*[@class='terminal']")
        terminal = elem
        terminal.send_keys("touch /tmp/testabc\n")
        terminal.send_keys("touch /tmp/testabd\n")
        terminal.send_keys("ls /tmp/test*\n")
        elem = self.wait_xpath(
            "//*[contains(text(), '%s') and contains(text(), '%s')]" % ('/tmp/testabc', '/tmp/testabd'))
        self.assertTrue("/tmp/testabc" in elem.text)
        process.run("ls /tmp/testabc", shell=True)
        time.sleep(self.default_sleep)
        terminal.send_keys("rm -v /tmp/testabc /tmp/testabd\n")
        time.sleep(self.default_sleep)
        process.run("ls /tmp/testabc |wc -l |grep 0", shell=True)
        process.run("ls /tmp/testabd |wc -l |grep 0", shell=True)
        self.mainframe()
        
if __name__ == '__main__':
    main()
