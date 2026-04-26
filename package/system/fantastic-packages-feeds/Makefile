# SPDX-License-Identifier: MIT

include $(TOPDIR)/rules.mk

PKG_NAME:=fantastic-packages-feeds
PKG_VERSION:=20251229
PKG_RELEASE:=2

PKG_MAINTAINER:=fantastic-packages
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=base
  CATEGORY:=Base system
  DEPENDS:=+fantastic-keyring
  TITLE:=Installer for fantastic-packages APK feeds
  PKGARCH:=all
endef

Build/Compile=

define Package/$(PKG_NAME)/install
	:
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh

revision_number() {
	printf '%s' "$$1" | sed 's/^[^0-9]*//; s/[^0-9].*//'
}

export REVISION VERSION_NUMBER ARCH_PACKAGES

if [ -n "$$IPKG_INSTROOT" ]; then
	eval "$$(grep CONFIG_VERSION_NUMBER "$$TOPDIR/.config")"
	eval "$$(grep CONFIG_VERSION_REPO "$$TOPDIR/.config")"
	eval "$$(grep CONFIG_TARGET_ARCH_PACKAGES "$$TOPDIR/.config")"
	eval "$$(grep BUILD_ID "$$IPKG_INSTROOT/usr/lib/os-release")"

	REVISION="$$(revision_number "$$BUILD_ID")"
	if [ -n "$$CONFIG_VERSION_REPO" ]; then
		VERSION_NUMBER="$${CONFIG_VERSION_REPO##*/}"
	else
		VERSION_NUMBER="$${CONFIG_VERSION_NUMBER:-SNAPSHOT}"
	fi
	ARCH_PACKAGES="$$CONFIG_TARGET_ARCH_PACKAGES"
else
	eval "$$(grep OPENWRT_ARCH /etc/os-release)"
	ARCH_PACKAGES="$$OPENWRT_ARCH"
	REVISION="$$(revision_number "$$(ubus call system board | jsonfilter -qe '@.release.revision')")"
	VERSION_NUMBER="$$(ubus call system board | jsonfilter -qe '@.release.version')"
fi

if [ "$$VERSION_NUMBER" = "SNAPSHOT" ]; then
	if [ "$${REVISION:-0}" -ge 32353 ] || [ "$${REVISION:-0}" -eq 0 ]; then
		BRANCH="25.12"
	else
		echo "Current version of OpenWrt is no longer supported, please upgrade!" >&2
		exit 1
	fi
else
	BRANCH="$$(echo "$$VERSION_NUMBER" | awk -F '.' -v OFS='.' '{print $$1,$$2}')"
fi

BASE_URL="https://fantastic-packages.github.io/releases"
REPO_FILE="$$IPKG_INSTROOT/etc/apk/repositories.d/customfeeds.list"

mkdir -p "$$(dirname "$$REPO_FILE")"
touch "$$REPO_FILE"

if ! grep -q "$$BASE_URL" "$$REPO_FILE"; then
	BASE_URL="$$BASE_URL/$$BRANCH/packages/$$ARCH_PACKAGES"
	cat <<- EOF >> "$$REPO_FILE"
	$$BASE_URL/packages/packages.adb
	$$BASE_URL/luci/packages.adb
	$$BASE_URL/special/packages.adb
	EOF
fi

exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
BASE_URL="https://fantastic-packages.github.io/releases"
sed -i "/$$BASE_URL/d" "$$IPKG_INSTROOT/etc/apk/repositories.d/customfeeds.list"
exit 0
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
