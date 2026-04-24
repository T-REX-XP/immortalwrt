#
# Linux media RC / infrared (GPIO receiver, etc.)
#

VIDEO_MENU_IR:=Video Support

define KernelPackage/ir-gpio-cir
  SUBMENU:=$(VIDEO_MENU_IR)
  TITLE:=GPIO consumer IR receiver (demodulator)
  DEPENDS:=+kmod-multimedia-input +kmod-input-core
  KCONFIG:=CONFIG_IR_GPIO_CIR
  FILES:=$(LINUX_DIR)/drivers/media/rc/gpio-ir-recv.ko
  AUTOLOAD:=$(call AutoProbe,gpio-ir-recv)
endef

define KernelPackage/ir-gpio-cir/description
  For TSOP17xx-style IR modules on a GPIO line. Requires a
  gpio-ir-receiver entry in the device tree (or an overlay) with
  linux,rc-map-name; use ir-keytable (v4l-utils) to load keymaps.
endef

$(eval $(call KernelPackage,ir-gpio-cir))
