/*
 * Citador — genera el manifiesto y el instalador para la dirección donde está alojado.
 */
(function (root) {
  "use strict";

  var ADDIN_ID = "c25eae07-dc84-4893-a2ba-aa63a6824c47";
  var VERSION = "1.0.0.0";

  function baseUrl() {
    var u = location.href.split("#")[0].split("?")[0];
    return u.slice(0, u.lastIndexOf("/"));
  }

  function manifest(base) {
    var B = base.replace(/\/$/, "");
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
'<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">\n' +
'  <Id>' + ADDIN_ID + '</Id>\n' +
'  <Version>' + VERSION + '</Version>\n' +
'  <ProviderName>Citador</ProviderName>\n' +
'  <DefaultLocale>es-ES</DefaultLocale>\n' +
'  <DisplayName DefaultValue="Citador"/>\n' +
'  <Description DefaultValue="Gestor de referencias: cita desde PubMed o DOI y cambia el formato de citas y bibliografía con un clic."/>\n' +
'  <IconUrl DefaultValue="' + B + '/assets/icon-32.png"/>\n' +
'  <HighResolutionIconUrl DefaultValue="' + B + '/assets/icon-64.png"/>\n' +
'  <SupportUrl DefaultValue="' + B + '/index.html"/>\n' +
'  <Hosts><Host Name="Document"/></Hosts>\n' +
'  <Requirements><Sets DefaultMinVersion="1.3"><Set Name="WordApi" MinVersion="1.3"/></Sets></Requirements>\n' +
'  <DefaultSettings><SourceLocation DefaultValue="' + B + '/taskpane.html"/></DefaultSettings>\n' +
'  <Permissions>ReadWriteDocument</Permissions>\n' +
'  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">\n' +
'    <Hosts>\n' +
'      <Host xsi:type="Document">\n' +
'        <DesktopFormFactor>\n' +
'          <GetStarted><Title resid="GS.Title"/><Description resid="GS.Desc"/><LearnMoreUrl resid="Help.Url"/></GetStarted>\n' +
'          <FunctionFile resid="Commands.Url"/>\n' +
'          <ExtensionPoint xsi:type="PrimaryCommandSurface">\n' +
'            <OfficeTab id="TabHome">\n' +
'              <Group id="Citador.Group">\n' +
'                <Label resid="Group.Label"/>\n' +
'                <Icon><bt:Image size="16" resid="Icon.16"/><bt:Image size="32" resid="Icon.32"/><bt:Image size="80" resid="Icon.80"/></Icon>\n' +
'                <Control xsi:type="Button" id="Citador.Open">\n' +
'                  <Label resid="Button.Label"/>\n' +
'                  <Supertip><Title resid="Button.Label"/><Description resid="Button.Tip"/></Supertip>\n' +
'                  <Icon><bt:Image size="16" resid="Icon.16"/><bt:Image size="32" resid="Icon.32"/><bt:Image size="80" resid="Icon.80"/></Icon>\n' +
'                  <Action xsi:type="ShowTaskpane"><TaskpaneId>CitadorPane</TaskpaneId><SourceLocation resid="Taskpane.Url"/></Action>\n' +
'                </Control>\n' +
'              </Group>\n' +
'            </OfficeTab>\n' +
'          </ExtensionPoint>\n' +
'        </DesktopFormFactor>\n' +
'      </Host>\n' +
'    </Hosts>\n' +
'    <Resources>\n' +
'      <bt:Images>\n' +
'        <bt:Image id="Icon.16" DefaultValue="' + B + '/assets/icon-16.png"/>\n' +
'        <bt:Image id="Icon.32" DefaultValue="' + B + '/assets/icon-32.png"/>\n' +
'        <bt:Image id="Icon.80" DefaultValue="' + B + '/assets/icon-80.png"/>\n' +
'      </bt:Images>\n' +
'      <bt:Urls>\n' +
'        <bt:Url id="Taskpane.Url" DefaultValue="' + B + '/taskpane.html"/>\n' +
'        <bt:Url id="Commands.Url" DefaultValue="' + B + '/commands.html"/>\n' +
'        <bt:Url id="Help.Url" DefaultValue="' + B + '/index.html"/>\n' +
'      </bt:Urls>\n' +
'      <bt:ShortStrings>\n' +
'        <bt:String id="Group.Label" DefaultValue="Citador"/>\n' +
'        <bt:String id="Button.Label" DefaultValue="Citas y bibliografía"/>\n' +
'        <bt:String id="GS.Title" DefaultValue="Citador está listo"/>\n' +
'      </bt:ShortStrings>\n' +
'      <bt:LongStrings>\n' +
'        <bt:String id="Button.Tip" DefaultValue="Abre el panel para citar referencias, insertar la bibliografía y cambiar el formato."/>\n' +
'        <bt:String id="GS.Desc" DefaultValue="En la pestaña Inicio, pulsa Citas y bibliografía para abrir el panel."/>\n' +
'      </bt:LongStrings>\n' +
'    </Resources>\n' +
'  </VersionOverrides>\n' +
'</OfficeApp>\n';
  }

  function b64utf8(s) {
    var bytes = new TextEncoder().encode(s), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function installer(base) {
    var m = b64utf8(manifest(base));
    return [
      "@echo off",
      "chcp 65001 >nul",
      "echo.",
      "echo  Instalando Citador para Word...",
      "echo.",
      "set \"DIR=%LOCALAPPDATA%\\Citador\"",
      "if not exist \"%DIR%\" mkdir \"%DIR%\"",
      "powershell -NoProfile -ExecutionPolicy Bypass -Command \"[IO.File]::WriteAllBytes($env:LOCALAPPDATA + '\\Citador\\manifest.xml', [Convert]::FromBase64String('" + m + "'))\"",
      "if errorlevel 1 goto error",
      "reg add \"HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer\" /v \"" + ADDIN_ID + "\" /t REG_SZ /d \"%DIR%\\manifest.xml\" /f >nul",
      "if errorlevel 1 goto error",
      "echo  Listo.",
      "echo.",
      "echo  1. Cierra Word por completo (todas las ventanas) y vuelve a abrirlo.",
      "echo  2. En la pestana Inicio veras el boton \"Citas y bibliografia\".",
      "echo     Si no aparece: Inicio ^> Complementos ^> Mas complementos ^> Mis complementos",
      "echo     ^> Complementos de desarrollador ^> Citador.",
      "echo.",
      "pause",
      "exit /b 0",
      ":error",
      "echo  No se pudo completar la instalacion.",
      "pause",
      "exit /b 1",
      ""
    ].join("\r\n");
  }

  function uninstaller() {
    return [
      "@echo off",
      "reg delete \"HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer\" /v \"" + ADDIN_ID + "\" /f >nul 2>&1",
      "del \"%LOCALAPPDATA%\\Citador\\manifest.xml\" >nul 2>&1",
      "echo Citador se ha desinstalado. Tu biblioteca no se borra.",
      "pause",
      ""
    ].join("\r\n");
  }

  var MAC_DIR = "~/Library/Containers/com.microsoft.Word/Data/Documents/wef";

  /** Comando para pegar en Terminal (macOS): crea la carpeta y escribe el manifiesto. */
  function macCommand(base) {
    var m = b64utf8(manifest(base));
    return "mkdir -p " + MAC_DIR + " && echo '" + m + "' | base64 -D > " + MAC_DIR + "/citador-manifest.xml && echo 'Citador instalado. Cierra Word (Cmd+Q) y vuelve a abrirlo.'";
  }

  function macUninstallCommand() {
    return "rm -f " + MAC_DIR + "/citador-manifest.xml && echo 'Citador desinstalado. Reinicia Word.'";
  }

  function download(name, text, type) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "application/octet-stream" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  root.CitadorInstall = { ADDIN_ID: ADDIN_ID, baseUrl: baseUrl, manifest: manifest, installer: installer, uninstaller: uninstaller, macCommand: macCommand, macUninstallCommand: macUninstallCommand, MAC_DIR: MAC_DIR, download: download };
})(window);
