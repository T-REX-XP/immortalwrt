# CM5 Base carrier: no onboard Wi-Fi — USB adapter appears asynchronously.
# Shared helpers for LuCI wireless stub removal and optimized LAN AP setup.

CM5_WIFI_COUNTRY="${CM5_WIFI_COUNTRY:-US}"
CM5_WIFI_CHANLIST="${CM5_WIFI_CHANLIST:-36-48 149-165}"

cm5_drop_wireless_placeholder() {
	uci -q get wireless.cm5_placeholder >/dev/null 2>&1 || return 0
	uci delete wireless.cm5_placeholder
	uci commit wireless
}

cm5_wifi_load_credentials() {
	[ -f /etc/credentials/cm5-wifi-ap ] || return 1
	# shellcheck disable=SC1091
	. /etc/credentials/cm5-wifi-ap
	[ -n "$CM5_WIFI_SSID" ] && [ -n "$CM5_WIFI_KEY" ]
}

cm5_wifi_save_credentials() {
	local ssid="$1"
	local key="$2"

	mkdir -p /etc/credentials
	chmod 700 /etc/credentials 2>/dev/null
	cat > /etc/credentials/cm5-wifi-ap <<EOF
CM5_WIFI_SSID='$ssid'
CM5_WIFI_KEY='$key'
EOF
	chmod 600 /etc/credentials/cm5-wifi-ap
}

cm5_wifi_gen_credentials() {
	local mac suffix ssid key

	mac=$(cat /sys/class/net/br-lan/address 2>/dev/null | tr -d ':')
	if [ -n "$mac" ]; then
		suffix=$(printf '%s' "$mac" | sed 's/.*\(....\)$/\1/')
	else
		suffix=$(date +%s | sed 's/.*\(....\)$/\1/')
	fi
	ssid="ImmortalWrt-CM5-${suffix}"
	key=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)
	cm5_wifi_save_credentials "$ssid" "$key"
}

cm5_wifi_ensure_credentials() {
	cm5_wifi_load_credentials || cm5_wifi_gen_credentials
}

cm5_radio_band() {
	local r="$1"
	local band phy path p dev

	band=$(uci -q get wireless."$r".band 2>/dev/null)
	if [ -n "$band" ]; then
		printf '%s' "$band" | tr 'A-Z' 'a-z'
		return 0
	fi

	phy=$(uci -q get wireless."$r".phy 2>/dev/null)
	if [ -z "$phy" ]; then
		path=$(uci -q get wireless."$r".path 2>/dev/null)
		for p in /sys/class/ieee80211/*; do
			[ -e "$p" ] || continue
			dev=$(readlink -f "$p/device" 2>/dev/null)
			case "$dev" in
			*"$path"*) phy=${p##*/}; break ;;
			esac
		done
	fi

	[ -n "$phy" ] || return 1

	if iw phy "$phy" info 2>/dev/null | grep -q "5180 MHz"; then
		echo 5g
	elif iw phy "$phy" info 2>/dev/null | grep -q "2412 MHz"; then
		echo 2g
	fi
}

cm5_tune_radio_5g() {
	local r="$1"

	uci -q batch <<-EOF
		delete wireless.$r.disabled
		set wireless.$r.band='5g'
		set wireless.$r.channel='auto'
		set wireless.$r.chanlist='$CM5_WIFI_CHANLIST'
		set wireless.$r.htmode='VHT80'
		set wireless.$r.country='$CM5_WIFI_COUNTRY'
		set wireless.$r.cell_density='1'
	EOF
}

cm5_tune_radio_2g_fallback() {
	local r="$1"

	uci -q batch <<-EOF
		delete wireless.$r.disabled
		set wireless.$r.band='2g'
		set wireless.$r.channel='auto'
		set wireless.$r.htmode='HT40'
		set wireless.$r.country='$CM5_WIFI_COUNTRY'
		set wireless.$r.cell_density='1'
	EOF
	logger -t cm5-wifi "no 5 GHz radio found; using 2.4 GHz HT40 fallback on $r"
}

cm5_disable_radio() {
	local r="$1"

	uci set wireless."$r".disabled='1'
}

cm5_find_ap_section() {
	local r="$1"
	local s name

	for s in $(uci -q show wireless | sed -n 's/^\(wireless\.[^=]*\)=wifi-iface$/\1/p'); do
		name="${s#wireless.}"
		[ "$(uci -q get wireless.$name.device 2>/dev/null)" = "$r" ] || continue
		printf '%s' "$name"
		return 0
	done
}

cm5_user_customized_ap() {
	local section="$1"
	local ssid

	[ -f /etc/.cm5_wifi_ap_configured ] || return 1
	ssid=$(uci -q get wireless."$section".ssid 2>/dev/null)
	[ -n "$ssid" ] || return 1

	case "$ssid" in
	ImmortalWrt-CM5|ImmortalWrt-CM5-*) return 1 ;;
	esac

	return 0
}

cm5_ensure_ap_iface() {
	local r="$1"
	local section

	section=$(cm5_find_ap_section "$r")
	[ -n "$section" ] || section=$(uci add wireless wifi-iface)

	uci -q batch <<-EOF
		set wireless.$section.device='$r'
		set wireless.$section.network='lan'
		set wireless.$section.mode='ap'
		set wireless.$section.disassoc_low_ack='0'
		delete wireless.$section.disabled
	EOF

	if cm5_user_customized_ap "$section"; then
		return 0
	fi

	cm5_wifi_ensure_credentials
	uci -q batch <<-EOF
		set wireless.$section.ssid='$CM5_WIFI_SSID'
		set wireless.$section.encryption='sae-mixed'
		set wireless.$section.key='$CM5_WIFI_KEY'
	EOF
}

# After wifi config: prefer 5 GHz VHT80 AP; disable extra 2.4 GHz radios.
# Runs once until /etc/.cm5_wifi_ap_configured exists; later boots must not call
# wifi config or retune radios (reload-sdio-wifi + ieee80211 hotplug fire every boot).
cm5_autoconfig_hotspot() {
	local radio band primary changed

	[ -f /etc/.cm5_wifi_ap_configured ] && return 0

	wifi config >/dev/null 2>&1

	changed=0
	primary=""

	is_managed_radio() {
		local r="$1"

		case "$r" in
		cm5_placeholder) return 1 ;;
		esac
		local p
		p=$(uci -q get wireless."$r".path 2>/dev/null)
		[ "$p" = "placeholder/no-radio" ] && return 1
		return 0
	}

	for radio in $(uci -q show wireless | sed -n "s/^wireless\.\([^.]*\)=wifi-device$/\1/p"); do
		is_managed_radio "$radio" || continue
		band=$(cm5_radio_band "$radio")
		[ "$band" = "5g" ] && [ -z "$primary" ] && primary="$radio"
	done

	if [ -z "$primary" ]; then
		for radio in $(uci -q show wireless | sed -n "s/^wireless\.\([^.]*\)=wifi-device$/\1/p"); do
			is_managed_radio "$radio" || continue
			band=$(cm5_radio_band "$radio")
			[ "$band" = "2g" ] && [ -z "$primary" ] && primary="$radio"
		done
	fi

	[ -n "$primary" ] || return 0

	for radio in $(uci -q show wireless | sed -n "s/^wireless\.\([^.]*\)=wifi-device$/\1/p"); do
		is_managed_radio "$radio" || continue
		band=$(cm5_radio_band "$radio")

		if [ "$radio" = "$primary" ]; then
			if [ "$band" = "5g" ]; then
				cm5_tune_radio_5g "$radio"
			else
				cm5_tune_radio_2g_fallback "$radio"
			fi
			cm5_ensure_ap_iface "$radio"
			logger -t cm5-wifi "primary AP on $radio (${band:-unknown}); credentials in /etc/credentials/cm5-wifi-ap"
		elif [ "$band" = "2g" ]; then
			cm5_disable_radio "$radio"
			logger -t cm5-wifi "disabled secondary 2.4 GHz radio $radio (5 GHz AP preferred)"
		fi
		changed=1
	done

	if [ "$changed" = "1" ]; then
		uci commit wireless
		touch /etc/.cm5_wifi_ap_configured
		wifi reload >/dev/null 2>&1 || wifi >/dev/null 2>&1
	fi
}
