var html5validator = function () {
	var prefManager = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);
	var validatorURL = prefManager.getCharPref("extensions.html5validator.validatorURL");

	const STATE_START = Components.interfaces.nsIWebProgressListener.STATE_START;
	const STATE_STOP = Components.interfaces.nsIWebProgressListener.STATE_STOP;
	var html5validatorListener = {
		QueryInterface: function(aIID) {
			if (aIID.equals(Components.interfaces.nsIWebProgressListener) || aIID.equals(Components.interfaces.nsISupportsWeakReference) || aIID.equals(Components.interfaces.nsISupports))
				return this;
			throw Components.results.NS_NOINTERFACE;
		},

		onStateChange: function(aWebProgress, aRequest, aFlag, aStatus) { },

		onLocationChange: function(aProgress, aRequest, aURI) {
			getAndValidateDocHTML();
		},

		onProgressChange: function(aWebProgress, aRequest, curSelf, maxSelf, curTot, maxTot) { },
		onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) { },
		onSecurityChange: function(aWebProgress, aRequest, aState) { }
	};
	var statusBarPanel, doc;
	var updateStatusBar = function(errors, warnings, status) {
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
			switch (status) {
				case "notrun":
					statusBarPanel.label = "";
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
					statusBarPanel.label = "";
					statusBarPanel.src = "chrome://html5validator/skin/html5-ok.png";
					statusBarPanel.tooltipText = "HTML5 Validator: No errors!";
			}
		}
	};

	var getAndValidateDocHTML = function () {
		// Get the current document's HTML by loading it again.
		// This should probably be changed to get the document from cache if possible.
		var url = Components.classes["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser").getBrowser().currentURI.spec;
		// Don't validate about:blank etc.
		if (url.match(/^about:/) || url == validatorURL) {
			updateStatusBar(0,0,"notrun");
			return;
		} else {
			var xhrGetPage = new XMLHttpRequest();
			xhrGetPage.onreadystatechange = function () {
				if (xhrGetPage.readyState === 4) {
					doc = xhrGetPage.responseText;
					if (!doc) {
						// Nothing returned from the XHR request
						updateStatusBar(0,0,"errorGettingHTML");
					} else {
						// Send the HTML to the validator
						validateDoc();
					}
				}
			};
			// If we couldn't load the page to get its HTML
			xhrGetPage.onerror = function () {
				updateStatusBar(0,0,"errorGettingHTML");
			};

			// Get page HTML
			xhrGetPage.open("GET", url, true);
			xhrGetPage.send(null);
		}
	};

	var validateDoc = function () {
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4) {
				// Turn the returned string into a JSON object
				var response = eval('(' + xhr.responseText + ')');
				if (!response) {
					// No valid JSON object returned
					updateStatusBar(0,0,"errorContactingValidator");
				}
				else {
					// Check how many errors and warnings were returned
					var messages = response.messages.length;
					var errors = warnings = 0;
					for (i=0; i<messages; i++) {
						if (response.messages[i].type == "error") {
							errors++;
						} else if (response.messages[i].subType == "warning") {
							warnings++;
						}
					}
					updateStatusBar(errors, warnings);
				}
			}
		};

		// If we couldn't validate the document (validator not running, network down, etc.)
		xhr.onerror = function () {
			updateStatusBar(0,0,"errorContactingValidator");
		};

		// Send document to validator and tell it to return results in JSON format
		xhr.open("POST", validatorURL + "?out=json", true);
		xhr.setRequestHeader("Content-Type", "text/html;charset=UTF-8");
		xhr.send(doc);
	};

	// Create a temporary form to post the document data to the validator.
	var showValidationResults = function () {
		var validationForm = content.document.createElement("form");
		validationForm.method = "post";
		validationForm.enctype = "multipart/form-data";
		validationForm.action = validatorURL;
		validationForm.target = "_blank";
		var docContent = content.document.createElement('textarea');
		docContent.name = "content";
		docContent.value = doc;
		validationForm.appendChild(docContent);
		var body = content.document.getElementsByTagName("body")[0];
		body.appendChild(validationForm);
		validationForm.submit();
		body.removeChild(validationForm);
	};

	return {
		init : function () {
			gBrowser.addProgressListener(html5validatorListener);
			statusBarPanel = document.getElementById('html5validator-status-bar');
		}
	};
}();
window.addEventListener("load", html5validator.init, false);