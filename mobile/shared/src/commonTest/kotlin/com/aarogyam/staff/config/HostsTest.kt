package com.aarogyam.staff.config

import com.aarogyam.staff.testConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HostsTest {
    @Test
    fun demo_uses_the_workers_dev_hosts() {
        val hosts = Hosts(testConfig(AppEnvironment.Demo))
        assertEquals("https://aarogyam-portal.spring-snow-130f.workers.dev", hosts.app().toString())
        assertEquals(
            "https://sunrise-aarogyam.spring-snow-130f.workers.dev",
            hosts.clinic("sunrise", "ignored.example").toString(),
        )
    }

    @Test
    fun local_uses_localtest_me_on_the_vite_port_in_debug_only() {
        assertEquals(
            "http://sunrise.localtest.me:5173",
            Hosts(testConfig(AppEnvironment.Local)).clinic("sunrise", null).toString(),
        )
        val release = Hosts(testConfig(AppEnvironment.Local).copy(debug = false))
        assertNull(release.app())
        assertNull(release.clinic("sunrise", null))
    }

    @Test
    fun prod_uses_the_host_the_api_reports_and_needs_an_app_host() {
        val hosts = Hosts(testConfig(AppEnvironment.Prod))
        assertNull(hosts.app())
        assertEquals("https://sunrise.aarogyam.example", hosts.clinic("sunrise", "sunrise.aarogyam.example").toString())
        assertNull(hosts.clinic("sunrise", null))
        assertEquals(
            "https://app.aarogyam.example",
            Hosts(testConfig(AppEnvironment.Prod).copy(prodAppHost = "app.aarogyam.example")).app().toString(),
        )
    }

    @Test
    fun a_slug_that_is_not_a_host_label_is_refused() {
        assertNull(Hosts(testConfig(AppEnvironment.Demo)).clinic("evil.example/x", null))
    }
}
