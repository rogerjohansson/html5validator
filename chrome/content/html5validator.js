var html5validator = function()
{
	var preferences = {},
		loadPreferences = function()
		{
			var prefBranch = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService).getBranch("extensions.html5validator."),
				whitelist = prefBranch.getCharPref("domainsWhitelist"),
				domains = (whitelist.length ? whitelist.split('\n') : []);

			// fix domains, accepts: domain OR http://domain OR https://domain
			for (var i = 0; i < domains.length; i++)
			{
				domains[i] = domains[i].replace(/(https?:\/\/)?(www\.)?([^\s\/]+)\/?/i, function(r, r1, r2, r3){
					return (r1.length ? r1.toLowerCase() : 'http://') + r3.toLowerCase() + '/';
				});
			}

			preferences = {
				validatorURL: prefBranch.getCharPref("validatorURL"),
				domainsWhitelist: domains,
				useTrigger: prefBranch.getBoolPref("useTrigger"),
				debug: prefBranch.getBoolPref("debug"),
				ignoreXHTMLErrors: prefBranch.getBoolPref("ignoreXHTMLErrors"),
				allowAccessibilityFeatures: prefBranch.getBoolPref("allowAccessibilityFeatures")
			};
		},
		// observe preferences changes
		preferencesObserver =
		{
			register: function()
			{
				var prefService = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService);
				this._branch = prefService.getBranch("extensions.html5validator.");
				this._branch.QueryInterface(Components.interfaces.nsIPrefBranch2);
				this._branch.addObserver("", this, false);
			},
			observe: function(aSubject, aTopic, aData)
			{
				if (aTopic != "nsPref:changed")
					return;
				loadPreferences();
			}
		},

		console = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService),
		log = function(msg)
		{
			if (!console || !preferences.debug) return;
			console.logStringMessage('html5validator: ' + msg);
		};


	var html5validatorListener = 
	{
		QueryInterface: function(aIID)
		{
			if (aIID.equals(Components.interfaces.nsIWebProgressListener) || 
				aIID.equals(Components.interfaces.nsISupportsWeakReference) || 
				aIID.equals(Components.interfaces.nsISupports))
				return this;
			throw Components.results.NS_NOINTERFACE;
		},

		onLocationChange: function(aProgress, aRequest, aURI)
		{
			updateStatusBar(0, 0, "notrun");
			validateDocHTML(window.content, false);
		},

		onStateChange: function(aWebProgress, aRequest, aFlag, aStatus){},
		onProgressChange: function(aWebProgress, aRequest, curSelf, maxSelf, curTot, maxTot){},
		onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage){},
		onSecurityChange: function(aWebProgress, aRequest, aState){}
	};


	var html5validatorObserver =
	{
		busy: false,
		observe: function(subject, topic, data) 
		{
			if (!this.busy)
			{
				this.busy = true;

				validateDocHTML(window.content, false);

				this.busy = false;
			}
		}
	};


	var statusBarPanel, activeDocument,
	
	isWhitelistDomain = function(url)
	{
		log('isWhitelistDomain() ' + url + ' - ' + preferences.domainsWhitelist.length);

		if (!url.length || url.match(/^about:/) || url == preferences.validatorURL)
			return false;

		// if no domains whitelisted, then validate all URLs
		if (!preferences.domainsWhitelist.length)
			return true;
		
		for (var i = 0; i < preferences.domainsWhitelist.length; i++)
		{
			var d = preferences.domainsWhitelist[i];
			if (d == url.replace('://www.', '://').substr(0, d.length))
				return true;

		}

		return false;
	},


	// Adapted from the "HTML Validator" extension by Marc Gueury (http://users.skynet.be/mgueury/mozilla/)
	validateDocHTML = function(frame, triggered)
	{
		if (!frame.document)
			return;

		activeDocument = frame.document;
		var url = activeDocument.URL || '';

		if (activeDocument.validatorCache != null)
		{
			var cache = activeDocument.validatorCache;

			updateStatusBar(cache['errors'], cache['warnings']);
		}
	    else
		{
			if (preferences.useTrigger && !triggered)
				return;

			if (!isWhitelistDomain(url))
			{
				updateStatusBar(0, 0, "notrun");
				return;
			}
			else
			{
				var html = getHTMLFromCache(activeDocument);
				if (html.length)
				{
					validateDoc(html);
				}
			}
		}
	},
	
	getActiveDocument = function()
	{
		return window.content.document;
	},
	
	// Adapted from the "HTML Validator" extension by Marc Gueury (http://users.skynet.be/mgueury/mozilla/)
	getHTMLFromCache = function(doc)
	{     
		var isLoading = document.getElementById("content").mCurrentBrowser.webProgress.isLoadingDocument;

		if (isLoading)
			return '';

		// Part 1 : get the history entry (nsISHEntry) associated with the document
		var webNav = null;
		try 
		{
			var win = doc.defaultView;
			if (win == window) 
				win = _content;

			var ifRequestor = win.QueryInterface(Components.interfaces.nsIInterfaceRequestor);
			webNav = ifRequestor.getInterface(Components.interfaces.nsIWebNavigation);
		} catch(err) {
			return '';
		}

		// Get the 'PageDescriptor' for the current document. This allows the
		// to access the cached copy of the content rather than refetching it from 
		// the network...
		try
		{
			var PageLoader = webNav.QueryInterface(Components.interfaces.nsIWebPageDescriptor),
				PageCookie = PageLoader.currentDescriptor,
				shEntry = PageCookie.QueryInterface(Components.interfaces.nsISHEntry);
		} catch(err) {
			return '';
		}

		// Part 2 : open a nsIChannel to get the HTML of the doc
		var url = doc.URL;
		var urlCharset = doc.characterSet;

		var ios = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
		var channel = ios.newChannel(url, urlCharset, null);
		channel.loadFlags |= Components.interfaces.nsIRequest.VALIDATE_NEVER;
		channel.loadFlags |= Components.interfaces.nsIRequest.LOAD_FROM_CACHE;
		channel.loadFlags |= Components.interfaces.nsICachingChannel.LOAD_ONLY_FROM_CACHE;

		try
		{
			// Use the cache key to distinguish POST entries in the cache (see nsDocShell.cpp)
			var cacheChannel = channel.QueryInterface(Components.interfaces.nsICachingChannel);
			cacheChannel.cacheKey = shEntry.cacheKey;
		} 
		catch(e) {
			return '';
		}

		var stream = channel.open();

		const scriptableStream = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance(Components.interfaces.nsIScriptableInputStream);
		scriptableStream.init(stream);
		var s = '', s2 = '';

		while (scriptableStream.available() > 0)
		{
			s += scriptableStream.read(scriptableStream.available());
		}
		scriptableStream.close();    
		stream.close();

		// Part 3 : convert the HTML in unicode
		try
		{
			var ucConverter =  Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].getService(Components.interfaces.nsIScriptableUnicodeConverter);
			ucConverter.charset = urlCharset;
			s2 = ucConverter.ConvertToUnicode(s);
		}
		catch(e) {
			return '';
		}

		return s2;
	},

	updateStatusBar = function(errors, warnings, status)
	{
		if (errors || warnings) {
			var errorText = "";
			if (errors) {
				errorText += errors + " error";
			}
			if (errors > 1) {
				errorText += "s";
			}
			if (errors && warnings) {
				errorText += " and ";
			}
			if (warnings) {
				errorText += warnings + " warning";
			}
			if (warnings > 1) {
				errorText += "s";
			}
			statusBarPanel.label = errorText;
			statusBarPanel.src = "chrome://html5validator/skin/html5-error-red.png";
			statusBarPanel.className = "statusbarpanel-iconic-text errors";
			statusBarPanel.tooltipText = "HTML5 Validator: Click to show validation details in a new window";
		}
		else
		{
			statusBarPanel.className = "statusbarpanel-iconic-text";
			statusBarPanel.label = "";
			switch (status) {
				case "running":
					statusBarPanel.src = "chrome://html5validator/skin/html5-dimmed.png";
					statusBarPanel.label = "Validating...";
					statusBarPanel.tooltipText = "HTML5 Validator: Document currently validating";
					break;
				case "notrun":
					statusBarPanel.src = "chrome://html5validator/skin/html5-dimmed.png";
					statusBarPanel.tooltipText = "HTML5 Validator: Document not validated";
					break;
				case "errorContactingValidator":
					statusBarPanel.label = "Error validating HTML";
					statusBarPanel.src = "chrome://html5validator/skin/html5-error-dimmed.png";
					statusBarPanel.tooltipText = "HTML5 Validator: Could not contact the validator";
					break;
				default:
					statusBarPanel.src = "chrome://html5validator/skin/html5-ok.png";
					statusBarPanel.tooltipText = "HTML5 Validator: No errors!";
			}
		}
	},

	validateDoc = function(html)
	{
		updateStatusBar(0, 0, "running");

		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4) {
				// Turn the returned string into a JSON object
				var response = (xhr.responseText.length ? eval('(' + xhr.responseText + ')') : false);
				if (!response) {
					// No valid JSON object returned
					updateStatusBar(0, 0, "errorContactingValidator");
				}
				else {
					// Check how many errors and warnings were returned
					var messages = response.messages.length,
						message,
						errors = 0, warnings = 0;
					for (var i = 0; i < messages; i++) {
						if (response.messages[i].type == "error") {
							if (preferences.ignoreXHTMLErrors) {
								// Do not count errors caused by an XHTML Doctype.
								// Not foolproof but matches XHTML 1.0 Strict/Transitional and 1.1 as long as no XML declaration is used.
								message = response.messages[i];
								if ((message.message.match(/^Legacy doctype./i) && message.extract.match(/<!DOCTYPE html PUBLIC \"-\/\/W3C\/\/DTD XHTML 1.(1|0 Strict|0 Transitional)\/\/EN/i)) || message.message.match(/^Attribute “xml:lang” not allowed/i)) {
									continue;
								}
							}
							if (preferences.allowAccessibilityFeatures) {
								// Do not count errors caused by removed accessibility features.
								// Currently allows the abbr, longdesc and scope attributes.
								message = response.messages[i];
								if (message.message.match(/The “abbr” attribute on the “(td|th)” element is obsolete|The “longdesc” attribute on the “img” element is obsolete|The “scope” attribute on the “td” element is obsolete/i)) {
									continue;
								}
							}
							errors++;
						} else if (response.messages[i].subType == "warning") {
							if (preferences.allowAccessibilityFeatures) {
								// Do not count warnings caused by removed accessibility features.
								// Currently allows the summary attribute.
								message = response.messages[i];
								if (message.message.match(/The “summary” attribute is obsolete/i)) {
									continue;
								}
							}
							warnings++;
						}
					}
					updateStatusBar(errors, warnings);

					activeDocument.validatorCache = {
						"messages": response.messages,
						"errors": errors,
						"warnings": warnings
					};
				}
			}
		};

		// If we couldn't validate the document (validator not running, network down, etc.)
		xhr.onerror = function(){
			updateStatusBar(0, 0, "errorContactingValidator");
		};

		// Send document to validator and tell it to return results in JSON format
		xhr.open("POST", preferences.validatorURL + "?out=json", true);
		xhr.setRequestHeader("Content-Type", "text/html;charset=UTF-8");
		xhr.send(html);
	},

	statusBarPanelClick = function(event)
	{
		// event.button: 0 - left, 1 - middle, 2 - right
		if (event.button == 0)
		{
			var doc = getActiveDocument();
			if (!doc)
				return;

			if (preferences.useTrigger)
			{
				// On first click there are no cached results - validate, on following clicks - show cached results
				if (doc.validatorCache && (doc.validatorCache['errors'] || doc.validatorCache['warnings']))
					showValidationResults();
				else
					validateDocHTML(window.content, true);
			}
			else
			{
				if (doc.validatorCache && (doc.validatorCache['errors'] || doc.validatorCache['warnings']))
					showValidationResults();
			}
		}
	},

	// Create a new document, open it in a new tab and display the cached validation results.
	showValidationResults = function()
	{
		var doc = getActiveDocument();
		if (!doc || !doc.validatorCache) {
			return;
		}
		log('showValidationResults() ' + doc.URL);

		// Create a new document in a new tab
		var request = new XMLHttpRequest();
		getBrowser().selectedTab = getBrowser().addTab('');
		request.open("get", "about:blank", false);
		request.send(null);
		var generatedDocument = window.content.document;

		var docBody = generatedDocument.getElementsByTagName('body')[0],
			docHead = generatedDocument.getElementsByTagName('head')[0];

		var docTitle = 'Validation results for ' + doc.URL;
		var errorsAndWarnings = doc.validatorCache.errors + ' errors and ' + doc.validatorCache.warnings + ' warnings';
		generatedDocument.title = docTitle + ': ' + errorsAndWarnings;

		// Insert styling using CSS file from the extension
		var linkCSS = generatedDocument.createElement('link');
		linkCSS.href = 'chrome://html5validator/skin/results.css';
		linkCSS.rel = 'stylesheet';
		linkCSS.type = 'text/css';
		docHead.appendChild(linkCSS);

		// Create the HTML content of the body – a heading and the list of messages with some elements and class names to enable styling
		var h1 = docBody.appendChild(generatedDocument.createElement('h1'));
		h1.innerHTML = docTitle;
		var h2 = docBody.appendChild(generatedDocument.createElement('h2'));
		h2.innerHTML = errorsAndWarnings;

		var errorList = docBody.appendChild(generatedDocument.createElement('ol'));
		var message, li, ext, st, len;
		for (var i = 0, l = doc.validatorCache.messages.length; i < l; i++) {
			message = doc.validatorCache.messages[i];
			if (preferences.ignoreXHTMLErrors) {
				// Do not show errors caused by an XHTML Doctype.
				// Not foolproof but matches XHTML 1.0 Strict/Transitional and 1.1 as long as no XML declaration is used.
				if ((message['message'].match(/^Legacy doctype./i) && message['extract'].match(/<!DOCTYPE html PUBLIC \"-\/\/W3C\/\/DTD XHTML 1.(1|0 Strict|0 Transitional)\/\/EN/i)) || message['message'].match(/^Attribute “xml:lang” not allowed/i)) {
					continue;
				}
			}
			if (preferences.allowAccessibilityFeatures) {
				// Do not show errors or warnings caused by removed accessibility features.
				// Currently allows the abbr, longdesc, summary and scope attributes.
				if (message['message'].match(/The “abbr” attribute on the “(td|th)” element is obsolete|The “longdesc” attribute on the “img” element is obsolete|The “scope” attribute on the “td” element is obsolete|The “summary” attribute is obsolete/i)) {
					continue;
				}
			}
			li = errorList.appendChild(generatedDocument.createElement('li'));
			li.className = message['type'] + (message['subType'] ? ' ' + message['subType'] : '');
			li.innerHTML = '<p><strong class="type">' + (message['subType'] ? ' ' + message['subType'] : message['type']) + ':</strong> ' + encodeHTML(message['message']) + '</p>';
			if (message['lastLine']) {
				li.innerHTML += '<p class="location">At line <span class="last-line">' + message['lastLine'] + '</span>' + (message['firstColumn'] ? ', column <span class="first-col">' + message['firstColumn'] : '') + '</span></p>';
			}
			if (message['extract']) {
				ext = message['extract'];
				if ((message['hiliteStart'] >= 0) && message['hiliteLength'])
				{
					st = message['hiliteStart'];
					len = message['hiliteLength'];
					ext = ext.substr(0, st) + '~^~' + ext.substr(st, len) + '~$~' + ext.substr(st + len);
					ext = encodeHTML(ext).replace('~^~', '<strong class="highlight">').replace('~$~', '</strong>');
				}
				else
					ext = encodeHTML(ext);
				li.innerHTML += '<pre class="extract"><code>' + ext + '</code></pre>';
			}
		}
	},
	encodeHTML = function(html) {
		return html.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
	};

	return {
		init: function ()
		{
			loadPreferences();

			gBrowser.addProgressListener(html5validatorListener);

			var oObsService = Components.classes["@mozilla.org/observer-service;1"].getService();
			var oObsInterface = oObsService.QueryInterface(Components.interfaces.nsIObserverService);
			oObsInterface.addObserver(html5validatorObserver, "EndDocumentLoad", false);

			statusBarPanel = document.getElementById('html5validator-status-bar');
			statusBarPanel.addEventListener("click", statusBarPanelClick, false);

			preferencesObserver.register();
		},
		
		showOptions: function()
		{
			window.openDialog("chrome://html5validator/content/options.xul", "", null);
		}
	};
}();

window.addEventListener("load", html5validator.init, false);