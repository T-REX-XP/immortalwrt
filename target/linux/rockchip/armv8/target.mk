ARCH:=aarch64
SUBTARGET:=armv8
BOARDNAME:=RK33xx/RK35xx boards (64 bit)
DEFAULT_PROFILE:=xunlong_orangepi-cm5-base

define Target/Description
	Build firmware image for Rockchip RK33xx/RK35xx devices.
	This firmware features a 64 bit kernel.
endef
