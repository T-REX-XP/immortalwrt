'use strict';
'require view';
'require rpc';
'require ui';

var callButtonList = rpc.declare({
	object: 'luci.peripherals',
	method: 'buttonList',
	expect: { names: [] }
});

var callButtonGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'buttonGet',
	params: ['name']
});

var callButtonSet = rpc.declare({
	object: 'luci.peripherals',
	method: 'buttonSet',
	params: ['name', 'content']
});

var callIrMapsGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'irMapsGet'
});

var callIrMapsSet = rpc.declare({
	object: 'luci.peripherals',
	method: 'irMapsSet',
	params: ['content']
});

var callIrKeymapsList = rpc.declare({
	object: 'luci.peripherals',
	method: 'irKeymapsList'
});

var callIrDevices = rpc.declare({
	object: 'luci.peripherals',
	method: 'irDevices'
});

var callIrApply = rpc.declare({
	object: 'luci.peripherals',
	method: 'irApply'
});

var callModuleDiagnostics = rpc.declare({
	object: 'luci.peripherals',
	method: 'moduleDiagnostics',
	expect: {
		uname_r: '',
		modules_release: '',
		lib_modules_path: '',
		lib_modules_exists: false,
		proc_modules_count: 0,
		modules_dep: false,
		items: [],
		required_ok: false,
		ir_stack_ok: false
	}
});

var callFanGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'fanGet',
	expect: { present: false, mode: 'auto', pwm_uci: 128 }
});

var callFanSet = rpc.declare({
	object: 'luci.peripherals',
	method: 'fanSet',
	params: ['mode', 'pwm']
});

var isReadonlyView = !L.hasViewPermission() || null;

function cbiSection(title, descrNodes, bodyNodes) {
	var parts = [];
	if (title)
		parts.push(E('h3', {}, [ title ]));
	if (descrNodes && descrNodes.length)
		parts.push(E('p', { 'class': 'cbi-section-descr' }, descrNodes));
	for (var i = 0; i < (bodyNodes || []).length; i++)
		parts.push(bodyNodes[i]);
	return E('div', { 'class': 'cbi-section' }, parts);
}

function tableTitles(headers) {
	return E('tr', { 'class': 'tr table-titles' }, headers.map(function(h) {
		return E('th', { 'class': 'th' }, [ h ]);
	}));
}

function fanMetaBlock(fan) {
	var diag = (fan || {}).diagnostics || {};
	if (!fan || !fan.present) {
		var hwmon = diag.hwmon || [];
		var rows = [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Device tree pwm-fan node') ]),
				E('td', { 'class': 'td' }, [ diag.dt_pwm_fan ? _('present') : _('missing') ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('pwm_fan module') ]),
				E('td', { 'class': 'td' }, [ diag.module_state || _('unknown') ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('pwm-fan.ko') ]),
				E('td', { 'class': 'td' }, [ diag.module_file ? _('present') : _('missing') ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Autoload file') ]),
				E('td', { 'class': 'td' }, [ diag.autoload ? _('present') : _('missing') ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Detected hwmon devices') ]),
				E('td', { 'class': 'td' }, [
					hwmon.length ? hwmon.map(function(h) {
						return '%s=%s'.format(h.id || '?', h.name || _('unnamed'));
					}).join(', ') : _('none')
				])
			])
		];

		return E('div', {}, [
			E('p', { 'class': 'alert-message warning' }, [
				_('No pwmfan device was found. If the device tree node is missing, the board is likely booting an older DTB/image. If the node exists but the module is missing or not loaded, reinstall/sysupgrade with the generated image or run %s and check %s.').format('modprobe pwm-fan', 'dmesg')
			]),
			E('table', { 'class': 'table' }, [
				tableTitles([ _('Check'), _('State') ]),
				E('tbody', {}, rows)
			])
		]);
	}
	return E('p', {}, [
		_('PWM: %s, control: %s, RPM: %s').format(
			fan.pwm1 != null ? fan.pwm1 : '—',
			fan.pwm1_enable != null ? fan.pwm1_enable : '—',
			fan.rpm != null && fan.rpm !== '' ? fan.rpm : _('n/a')
		)
	]);
}

return view.extend({
	load: function() {
		return callButtonList().then(L.bind(function(list) {
			var names = list.names || [];
			var listError = list.error || null;
			if (!names.length) {
				return Promise.all([
					Promise.resolve({ names: [], content: '', current: '', listError: listError }),
					callIrMapsGet(),
					callIrKeymapsList(),
					callIrDevices(),
					callModuleDiagnostics(),
					callFanGet()
				]);
			}
			return callButtonGet(names[0]).then(L.bind(function(bg) {
				return Promise.all([
					Promise.resolve({
						names: names,
						content: bg.content != null ? bg.content : '',
						current: names[0],
						listError: null
					}),
					callIrMapsGet(),
					callIrKeymapsList(),
					callIrDevices(),
					callModuleDiagnostics(),
					callFanGet()
				]);
			}, this));
		}, this)).then(function(parts) {
			return {
				btn: parts[0],
				irMaps: parts[1],
				irKms: parts[2],
				irDev: parts[3],
				diags: parts[4],
				fan: parts[5]
			};
		});
	},

	buildDiagnosticsSection: function(diags) {
		diags = diags || {};
		var items = diags.items || [];
		var summaryClass = 'alert-message success';
		var summaryParts = [];

		if (!diags.lib_modules_exists)
			summaryClass = 'alert-message error';
		else if (!diags.required_ok)
			summaryClass = 'alert-message error';
		else if (!diags.ir_stack_ok)
			summaryClass = 'alert-message warning';

		if (diags.required_ok && diags.ir_stack_ok && diags.lib_modules_exists)
			summaryParts.push(_('Kernel modules needed for buttons and IR look acceptable.'));
		if (!diags.lib_modules_exists)
			summaryParts.push(_('The module directory for this kernel is missing. Loadable modules will not work until kernel and rootfs match (use a full sysupgrade from one build).'));
		if (!diags.required_ok)
			summaryParts.push(_('One or more required kernel features are not loaded or built in.'));
		else if (!diags.ir_stack_ok)
			summaryParts.push(_('Infrared kernel modules are not loaded. On Orange Pi CM5 Base this does not enable the onboard IR receiver by itself, because the onboard receiver needs PWM input-capture support that is not available in the current upstream kernel binding/driver.'));

		var summary = E('div', { 'class': summaryClass }, [
			E('strong', {}, [ _('Status') ]),
			E('br'),
			summaryParts.length ? summaryParts.join(' ') : _('Review the details below.')
		]);

		var metaRows = [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'white-space:nowrap' }, [ _('Kernel release') + ' (uname -r)' ]),
				E('td', { 'class': 'td' }, [ diags.uname_r || '—' ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Module path') ]),
				E('td', { 'class': 'td' }, [
					'%s (%s)'.format(
						diags.lib_modules_path || '/lib/modules/…',
						diags.lib_modules_exists ? _('present') : _('missing')
					)
				])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Loaded modules (/proc/modules)') ]),
				E('td', { 'class': 'td' }, [ '%d'.format(diags.proc_modules_count | 0) ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ 'modules.dep' ]),
				E('td', { 'class': 'td' }, [
					diags.modules_dep ? _('found') : _('not found')
				])
			])
		];
		if (diags.modules_release && diags.modules_release !== diags.uname_r) {
			metaRows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Module directory name (fallback)') ]),
				E('td', { 'class': 'td' }, [ diags.modules_release ])
			]));
		}

		var metaTable = E('table', { 'class': 'table' }, [
			tableTitles([ _('Property'), _('Value') ]),
			E('tbody', {}, metaRows)
		]);

		var modRows = items.map(L.bind(function(it) {
			var st = it.state || 'missing';
			var stateLabel = st === 'loaded' ? _('module loaded') :
				st === 'builtin' ? _('built into kernel') :
				_('not available');
			var rowClass = 'tr';
			if (st === 'missing' && !it.optional)
				rowClass = 'tr cbi-rowstyle-2';
			else if (st === 'missing' && it.optional)
				rowClass = 'tr cbi-rowstyle-1';
			return E('tr', { 'class': rowClass }, [
				E('td', { 'class': 'td' }, [ E('code', {}, [ it.module || '' ]) ]),
				E('td', { 'class': 'td' }, [ it.label || '' ]),
				E('td', { 'class': 'td' }, [ it.optional ? _('optional') : _('required') ]),
				E('td', { 'class': 'td' }, [ stateLabel ])
			]);
		}, this));

		var modTable = E('table', { 'class': 'table' }, [
			tableTitles([ _('Module'), _('Purpose'), _('Expectation'), _('State') ]),
			E('tbody', { 'id': 'periph-diag-body' }, modRows)
		]);

		return E('div', { 'id': 'periph-diag-root' }, [
			cbiSection(
				_('Overview'),
				[ _('These checks are read-only. They compare the running kernel, %s layout, and related modules.').format('/lib/modules') ],
				[ summary, metaTable ]
			),
			cbiSection(
				_('Peripheral-related modules'),
				null,
				[ modTable ]
			),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleDiagRefresh')
				}, _('Refresh'))
			])
		]);
	},

	handleDiagRefresh: function() {
		return callModuleDiagnostics().then(L.bind(function(d) {
			var root = document.getElementById('periph-diag-root');
			if (!root || !root.parentNode)
				return;
			var next = this.buildDiagnosticsSection(d);
			root.parentNode.replaceChild(next, root);
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Could not refresh diagnostics: %s').format(e) ]), 'error');
		});
	},

	handleBtnSave: function() {
		var sel = document.getElementById('periph-btn-sel');
		var ta = document.querySelector('#periph-btn-ta');
		if (!sel || !ta || ta.disabled)
			return Promise.resolve();
		var name = sel.value;
		var content = String(ta.value || '').replace(/\r\n/g, '\n');
		return callButtonSet(name, content).then(L.bind(function(r) {
			if (r.error)
				ui.addNotification(null, E('p', {}, [ '%s'.format(r.error) ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('The script "%s" has been saved.').format(name) ]), 'info');
		}, this));
	},

	handleBtnChange: function(ev) {
		var n = ev.target.value;
		if (!n)
			return;
		return callButtonGet(n).then(function(r) {
			var ta = document.querySelector('#periph-btn-ta');
			if (ta)
				ta.value = r.content != null ? r.content : '';
		});
	},

	handleMapsSave: function() {
		var ta = document.querySelector('#periph-ir-maps');
		if (!ta || ta.disabled)
			return Promise.resolve();
		var content = String(ta.value || '').replace(/\r\n/g, '\n');
		return callIrMapsSet(content).then(function(r) {
			if (r.error)
				ui.addNotification(null, E('p', {}, [ '%s'.format(r.error) ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('The file %s has been saved.').format('/etc/rc_maps.cfg') ]), 'info');
		});
	},

	handleIrApply: function() {
		return callIrApply().then(function(r) {
			var msg = E('div', {}, [
				E('p', {}, [ r.ok ? _('The keymaps were applied successfully.') : _('Keymap application reported an error.') ]),
				r.output ? E('pre', { 'style': 'white-space:pre-wrap;word-break:break-word' }, [ r.output ]) : ''
			]);
			ui.addNotification(null, msg, r.ok ? 'info' : 'warning');
		});
	},

	handleFanApply: function() {
		var sel = document.getElementById('periph-fan-mode');
		var rng = document.getElementById('periph-fan-pwm');
		if (!sel || sel.disabled)
			return Promise.resolve();
		var mode = sel.value || 'auto';
		var pwm = rng ? (parseInt(rng.value, 10) || 0) : 128;
		if (pwm < 0)
			pwm = 0;
		if (pwm > 255)
			pwm = 255;
		return callFanSet(mode, pwm).then(function(r) {
			if (r.error)
				ui.addNotification(null, E('p', {}, [ '%s: %s'.format(r.error, r.message || '') ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('Fan settings have been saved.') ]), 'info');
		});
	},

	handleFanRefresh: function() {
		return callFanGet().then(L.bind(function(f) {
			var el = document.getElementById('periph-fan-meta');
			if (!el)
				return;
			el.innerHTML = '';
			el.appendChild(fanMetaBlock(f));
		}, this));
	},

	buildFanTab: function(fan) {
		fan = fan || {};
		var pwmVal = fan.pwm_uci != null ? fan.pwm_uci : 128;
		var fanSectionBody = [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Current readings') ]),
				E('div', { 'id': 'periph-fan-meta', 'class': 'cbi-value-field' }, [ fanMetaBlock(fan) ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Mode') ]),
				E('div', { 'class': 'cbi-value-field' }, [
					E('select', {
						'id': 'periph-fan-mode',
						'disabled': isReadonlyView || !fan.present
					}, [
						E('option', { 'value': 'auto', 'selected': fan.mode === 'auto' }, [ _('Automatic (thermal)') ]),
						E('option', { 'value': 'manual', 'selected': fan.mode === 'manual' }, [ _('Manual PWM') ]),
						E('option', { 'value': 'off', 'selected': fan.mode === 'off' }, [ _('Off') ])
					])
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('PWM duty cycle') ]),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'type': 'range',
						'id': 'periph-fan-pwm',
						'min': 0,
						'max': 255,
						'value': pwmVal,
						'disabled': isReadonlyView || !fan.present,
						'input': function(ev) {
							var lbl = document.getElementById('periph-fan-pwm-lbl');
							if (lbl)
								lbl.textContent = ev.target.value;
						}
					}),
					' ',
					E('span', { 'id': 'periph-fan-pwm-lbl', 'style': 'font-family:monospace;margin-left:0.5em' }, [ String(pwmVal) ])
				])
			])
		];

		return E('div', { 'data-tab': 'fan', 'data-tab-title': _('Cooling fan') }, [
			cbiSection(
				_('PWM fan'),
				[
					_('PWM-controlled cooling fan (hwmon name %s). On the Orange Pi CM5 Base this is typically tied to PWM3 and the thermal subsystem.').format('pwmfan')
				],
				fanSectionBody
			),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-save',
					'click': ui.createHandlerFn(this, 'handleFanApply'),
					'disabled': isReadonlyView || !fan.present
				}, _('Save')),
				' ',
				E('button', {
					'class': 'btn cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleFanRefresh')
				}, _('Refresh readings'))
			])
		]);
	},

	render: function(data) {
		var btn = data.btn || { names: [], content: '', current: '', listError: null };
		var irMaps = data.irMaps || { content: '' };
		var irKms = data.irKms || { files: [] };
		var irDev = data.irDev || { devices: [] };
		var diags = data.diags || {};
		var fan = data.fan || {};

		var btnSel = E('select', {
			'id': 'periph-btn-sel',
			'disabled': isReadonlyView || !btn.names.length,
			'change': ui.createHandlerFn(this, 'handleBtnChange')
		});
		for (var i = 0; i < btn.names.length; i++)
			btnSel.appendChild(E('option', {
				'value': btn.names[i],
				'selected': btn.names[i] === btn.current
			}, [ btn.names[i] ]));

		var btnTa = E('textarea', {
			'id': 'periph-btn-ta',
			'class': 'cbi-input-textarea',
			'style': 'width:100%;min-height:16em;font-family:monospace',
			'disabled': isReadonlyView
		}, [ btn.content || '' ]);

		var devRows = (irDev.devices || []).map(function(d) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ d.id || '' ]),
				E('td', { 'class': 'td' }, [ E('code', { 'style': 'white-space:pre-wrap;word-break:break-word;font-size:90%' }, [ d.uevent || '' ]) ])
			]);
		});

		var devTable = E('table', { 'class': 'table' }, [
			tableTitles([ _('Device'), _('Properties (uevent)') ]),
			E('tbody', {}, devRows)
		]);

		var kmList = E('ul', { 'style': 'margin:0.5em 0' }, (irKms.files || []).map(function(f) {
			return E('li', {}, [ f ]);
		}));

		var mapsTa = E('textarea', {
			'id': 'periph-ir-maps',
			'class': 'cbi-input-textarea',
			'style': 'width:100%;min-height:14em;font-family:monospace',
			'disabled': isReadonlyView
		}, [ irMaps.content != null ? irMaps.content : '' ]);

		var tabButtons = E('div', { 'data-tab': 'buttons', 'data-tab-title': _('Buttons') }, [
			cbiSection(
				_('GPIO button scripts'),
				[
					_('Scripts in %s are run when GPIO keys trigger hotplug events (for example reset or WPS). Keep an SSH session open while editing.').format('/etc/rc.button/')
				],
				[
					!btn.names.length ? E('p', { 'class': 'alert-message warning' }, [
						btn.listError === 'no_button_dir'
							? _('%s is missing or not readable (verify with %s). Recreate it or fix permissions; stock OpenWrt installs scripts from %s.').format(
								'/etc/rc.button/',
								'ls -la /etc/rc.button/',
								'base-files')
							: _('No editable script names under %s (folder empty, or names not matching %s). Check with %s. Physical buttons also need %s loaded and %s keys in the device tree with a %s the hotplug driver supports.').format(
								'/etc/rc.button/',
								'[a-zA-Z0-9._-]+',
								'ls -la /etc/rc.button/',
								'gpio-button-hotplug',
								'gpio-keys',
								'linux,code')
					]) : '',
					E('div', { 'class': 'cbi-section-node' }, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, [ _('Script file') ]),
							E('div', { 'class': 'cbi-value-field' }, [ btnSel ])
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, [ _('Contents') ]),
							E('div', { 'class': 'cbi-value-field' }, [ btnTa ])
						])
					]),
					E('div', { 'class': 'cbi-page-actions' }, [
						E('button', {
							'class': 'btn cbi-button-save',
							'click': ui.createHandlerFn(this, 'handleBtnSave'),
							'disabled': isReadonlyView || !btn.names.length
						}, _('Save'))
					])
				].filter(Boolean)
			)
		]);

		var tabIr = E('div', { 'data-tab': 'ir', 'data-tab-title': _('Infrared') }, [
			E('p', { 'class': 'alert-message notice' }, [
				_('Orange Pi CM5 Base has onboard IR hardware, but the current upstream kernel cannot expose it as an RC device yet because the receiver is wired through PWM input capture. Keymap editing remains available for future support or for external receivers that create %s entries.').format('/sys/class/rc/rc*')
			]),
			cbiSection(
				_('RC core'),
				[ _('Kernel remote control devices (%s).').format('/sys/class/rc/') ],
				[
					(irDev.devices || []).length ? devTable : E('p', { 'class': 'alert-message notice' }, [
						_('No RC devices were found. This is expected for the onboard CM5 Base IR receiver with the current kernel. If you attach a separate supported receiver, verify its device tree/overlay and that %s and %s are loaded.').format('kmod-multimedia-input', 'kmod-ir-gpio-cir')
					])
				]
			),
			cbiSection(
				_('Keymap files'),
				[ _('Files shipped under %s (usually with %s).').format('/etc/rc_keymaps/', 'v4l-utils') ],
				[
					(irKms.files || []).length ? kmList : E('p', { 'class': 'alert-message notice' }, [
						irKms.missing ? _('The directory is missing. Install %s.').format('v4l-utils') : _('No keymap files are installed.')
					])
				]
			),
			cbiSection(
				_('Map configuration'),
				[ _('Contents of %s, which links remotes to keymap files.').format('/etc/rc_maps.cfg') ],
				[
					E('div', { 'class': 'cbi-section-node' }, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, [ _('File contents') ]),
							E('div', { 'class': 'cbi-value-field' }, [ mapsTa ])
						])
					]),
					E('div', { 'class': 'cbi-page-actions' }, [
						E('button', {
							'class': 'btn cbi-button-save',
							'click': ui.createHandlerFn(this, 'handleMapsSave'),
							'disabled': isReadonlyView
						}, _('Save')),
						' ',
						E('button', {
							'class': 'btn cbi-button-apply',
							'click': ui.createHandlerFn(this, 'handleIrApply'),
							'disabled': isReadonlyView
						}, _('Apply keymaps'))
					])
				]
			)
		]);

		var viewRoot = E([], [
			E('h2', {}, [ _('Peripherals') ]),
			E('p', { 'class': 'cbi-map-descr' }, [
				_('Manage hardware buttons, infrared reception, the PWM cooling fan, and kernel module diagnostics.')
			]),
			E('div', {}, [
				tabButtons,
				tabIr,
				this.buildFanTab(fan),
				E('div', { 'data-tab': 'diagnostics', 'data-tab-title': _('Diagnostics') }, [
					this.buildDiagnosticsSection(diags)
				])
			])
		]);

		ui.tabs.initTabGroup(viewRoot.lastElementChild.childNodes);
		return viewRoot;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
