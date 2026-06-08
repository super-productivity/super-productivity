package com.superproductivity.superproductivity.app

import org.junit.Assert.assertEquals
import org.junit.Test

class LaunchDeciderTest {

    @Test
    fun `fresh installs use offline mode even when Android backup restored online preference`() {
        assertEquals(
            LaunchDecider.MODE_OFFLINE,
            LaunchDecider.resolveDefaultLaunchMode(
                storedMode = LaunchDecider.MODE_ONLINE,
                isFreshInstall = true,
                hasLegacyData = true,
            ),
        )
    }

    @Test
    fun `upgraded installs keep stored online mode`() {
        assertEquals(
            LaunchDecider.MODE_ONLINE,
            LaunchDecider.resolveDefaultLaunchMode(
                storedMode = LaunchDecider.MODE_ONLINE,
                isFreshInstall = false,
                hasLegacyData = false,
            ),
        )
    }

    @Test
    fun `upgraded installs with no stored mode use online mode for legacy data`() {
        assertEquals(
            LaunchDecider.MODE_ONLINE,
            LaunchDecider.resolveDefaultLaunchMode(
                storedMode = LaunchDecider.MODE_DEFAULT,
                isFreshInstall = false,
                hasLegacyData = true,
            ),
        )
    }

    @Test
    fun `upgraded installs with no stored mode use offline mode without legacy data`() {
        assertEquals(
            LaunchDecider.MODE_OFFLINE,
            LaunchDecider.resolveDefaultLaunchMode(
                storedMode = LaunchDecider.MODE_DEFAULT,
                isFreshInstall = false,
                hasLegacyData = false,
            ),
        )
    }
}
