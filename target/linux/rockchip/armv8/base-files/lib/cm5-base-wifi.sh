# CM5 Base carrier: no onboard Wi-Fi — USB adapter appears asynchronously.
# Shared helpers for LuCI wireless stub removal and default LAN AP setup.

cm5_drop_wireless_placeholder() {
	uci -q get wireless.cm5_placeholder >/dev/null 2>&1 || return 0
	uci delete wireless.cm5_placeholder
	uci commit wireless
}

# After wifi config: enable each real radio (not cm5_placeholder) and attach a LAN AP.
cm5_autoconfig_hotspot() {
	local radio section changed

	wifi config >/dev/null 2>&1

	changed=0

	is_managed_radio() {
		local r="$1"
		case "$r" in
		cm5_placeholder) return 1 ;;
		esac
		local p
		p="$(uci -q get wireless."$r".path)"
		[ "$p" = "placeholder/no-radio" ] && return 1
		return 0
	}

	ensure_ap_iface() {
		local r="$1"

		section="$(uci -q show wireless | sed -n "s/^\(wireless\.[^.]*\)=wifi-iface$/\1/p" | while read -r s; do
			[ "$(uci -q get "$s".device)" = "$r" ] && {
				echo "${s#wireless.}"
				break
			}
		done)"

		if [ -z "$section" ]; then
			section="$(uci add wireless wifi-iface)"
			changed=1
		fi

		uci -q batch <<-EOF
			set wireless.$section.device='$r'
			set wireless.$section.network='lan'
			set wireless.$section.mode='ap'
			set wireless.$section.ssid='ImmortalWrt-CM5'
			set wireless.$section.encryption='psk2'
			set wireless.$section.key='immortalwrt-cm5'
			delete wireless.$section.disabled
		EOF
		changed=1
	}

	for radio in $(uci -q show wireless | sed -n "s/^wireless\.\([^.]*\)=wifi-device$/\1/p"); do
		is_managed_radio "$radio" || continue

		uci -q batch <<-EOF
			delete wireless.$radio.disabled
			set wireless.$radio.country='US'
		EOF
		ensure_ap_iface "$radio"
		logger -t cm5-wifi "configured radio $radio as ImmortalWrt-CM5 hotspot"
	done

	if [ "$changed" = "1" ]; then
		uci commit wireless
		wifi reload >/dev/null 2>&1 || wifi >/dev/null 2>&1
	fi
}
