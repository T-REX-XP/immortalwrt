# SPDX-License-Identifier: Apache-2.0
#
# LuCI + rpcd/ucode backend for GPIO button scripts and IR remote (RC core).

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Peripherals (buttons, IR, fan)
# luci-base pulls rpcd-mod-ucode, ucode-mod-fs, ...; v4l-utils provides ir-keytable for IR Apply.
LUCI_DEPENDS:=+luci-base +v4l-utils +kmod-gpio-button-hotplug +kmod-ir-gpio-cir +kmod-hwmon-pwmfan
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Immortal OPI CM5 overlay

define Package/luci-app-peripherals/conffiles
/etc/config/luci_peripherals
endef

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
