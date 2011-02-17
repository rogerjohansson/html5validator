var html5validator = function()
{
	var prefBranch = Components.classes["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch("extensions.html5validator."),
		validatorURL = prefBranch.getCharPref("validatorURL"),
		debug = prefBranch.getBoolPref("debug"),

		console = Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService),
		statusBarPanel, activeDocument,

		log = function(msg)
		{
			if (!console || !debug) return;
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
			validateDocHTML(window.content);
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

				validateDocHTML(window.content);

				this.busy = false;
			}
		}
	};



	// adapted from "Html Validator" extension
	var validateDocHTML = function(frame)
	{
		if (!frame.document)
			return;

		if (frame.document.validatorCache != null)
		{
			var cache = frame.document.validatorCache;
			updateStatusBar(cache['errors'], cache['warnings']);
		}
	    else
		{
			activeDocument = frame.document;

			var url = activeDocument.URL || '';

			if (!url.length || url.match(/^about:/) || url == validatorURL) {
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
	}
	
	// adapted from "Html Validator" extension
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
			// If nsIWebNavigation cannot be found, just get the one for the whole window...
			webNav = getWebNavigation();
		}

		// Get the 'PageDescriptor' for the current document. This allows the
		// to access the cached copy of the content rather than refetching it from 
		// the network...
		try
		{
			var PageLoader = webNav.QueryInterface(Components.interfaces.nsIWebPageDescriptor);
			var pageCookie = PageLoader.currentDescriptor;     
			var shEntry = pageCookie.QueryInterface(Components.interfaces.nsISHEntry);
		} catch(err) {
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
		catch(e) 
		{
		}

		var stream = channel.open();

		const scriptableStream = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance(Components.interfaces.nsIScriptableInputStream);
		scriptableStream.init( stream );
		var s = '', s2 = '';

		// XXX Maybe there should be a flag for controlling this ?
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
		catch(e) 
		{
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
			statusBarPanel.addEventListener("click", showValidationResults, false);
			statusBarPanel.tooltipText = "HTML5 Validator: Click to show validation details in a new window";
		} else {
			statusBarPanel.removeEventListener("click", showValidationResults, false);
			statusBarPanel.className = "statusbarpanel-iconic-text";
			statusBarPanel.label = "";
			switch (status) {
				case "notrun":
					statusBarPanel.src = "chrome://html5validator/skin/html5-dimmed.png";
					statusBarPanel.tooltipText = "HTML5 Validator: Document not validated";
					break;
				case "errorGettingHTML":
					statusBarPanel.label = "Error getting HTML";
					statusBarPanel.src = "chrome://html5validator/skin/html5-error-dimmed.png";
					statusBarPanel.tooltipText = "HTML5 Validator: Could not get HTML for the current document.";
					break;
				case "errorContactingValidator":
					statusBarPanel.label = "Error validating HTML";
					statusBarPanel.src = "chrome://html5validator/skin/html5-error-dimmed.png";
					statusBarPanel.tooltipText = "HTML5 Validator: Could not contact the validator to validate the current document.";
					break;
				default:
					statusBarPanel.src = "chrome://html5validator/skin/html5-ok.png";
					statusBarPanel.tooltipText = "HTML5 Validator: No errors!";
			}
		}
	},

	validateDoc = function(html)
	{
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4) {
				// Turn the returned string into a JSON object
				var response = eval('(' + xhr.responseText + ')');
				if (!response) {
					// No valid JSON object returned
					updateStatusBar(0, 0, "errorContactingValidator");
				}
				else {
					// Check how many errors and warnings were returned
					var messages = response.messages.length,
						errors = 0, warnings = 0;
					for (var i = 0; i < messages; i++) {
						if (response.messages[i].type == "error") {
							errors++;
						} else if (response.messages[i].subType == "warning") {
							warnings++;
						}
					}
					updateStatusBar(errors, warnings);

					activeDocument.validatorCache = {
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
		xhr.open("POST", validatorURL + "?out=json", true);
		xhr.setRequestHeader("Content-Type", "text/html;charset=UTF-8");
		xhr.send(html);
	},

	// Create a temporary form to post the document data to the validator.
	showValidationResults = function()
	{
		var validationForm = content.document.createElement("form");
		validationForm.method = "post";
		validationForm.enctype = "multipart/form-data";
		validationForm.action = validatorURL;
		validationForm.target = "_blank";
		var docContent = content.document.createElement('textarea');
		docContent.name = "content";
		docContent.value = getHTMLFromCache(getActiveDocument());
		validationForm.appendChild(docContent);
		var body = content.document.getElementsByTagName("body")[0];
		body.appendChild(validationForm);
		validationForm.submit();
		body.removeChild(validationForm);
	};

	return {
		init: function ()
		{
			gBrowser.addProgressListener(html5validatorListener);

			var oObsService = Components.classes["@mozilla.org/observer-service;1"].getService();
			var oObsInterface = oObsService.QueryInterface(Components.interfaces.nsIObserverService);
			oObsInterface.addObserver(html5validatorObserver, "EndDocumentLoad", false);

			statusBarPanel = document.getElementById('html5validator-status-bar');
		}
	};
}();

window.addEventListener("load", html5validator.init, false);