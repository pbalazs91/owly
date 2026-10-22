// Set library options before the bundled WA-JS code is initialized.
window.WPPConfig = {
  ...(window.WPPConfig || {}),
  disableGoogleAnalytics: true,
  linkPreviewApiServers: [],
  sendStatusToDevice: false,
};
