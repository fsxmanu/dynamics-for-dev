# PowerWebResource-Manager

Dynamics-For-Dev makes developing for Dynamics easier without leaving your coding environment.

## Features

* Add new webresources to CRM
* Update existing web resources in CRM
* All webresource types are supported
* Use the Azure Authentication to connect to Dynamics Cusetomer Engagement (CRM)

## Requirements

To connect to dynamics you need to sign in to azure with the Azure Account (identifier: ms-vscode.azure-account) extension. It should have been installed with this extension.
To check just search for `Azure: Sign In` in your Command Palette and sign in.

## Use it

First you need to create a dynamicsConfig.json file. For this you just right click in your Visual Studio workspace explorer and select the new menu point "Add new dynamicsConfig.json".

<img src="https://user-images.githubusercontent.com/22397350/139916131-9f98f188-f081-44b8-93cc-794d159be026.png" alt="drawing" width="350"/>


Then you need to configure the json so you can upload the webresource. The target is that you only need to do this once.

After that:

You can call the upload command via the command palette in vs code. Search for "Dynamics-For-Dev: Upload WebResource" and follow the instructions.
Alternatively you can right click a supported file (See [Supported Files](#supported-files)) and use the "Upload to Dynamics" command in the context menu.

<img src="https://user-images.githubusercontent.com/22397350/139915944-61c32ebe-32d9-45a7-9f67-185f010154b2.png" alt="drawing" width="350"/>

To downlaod web resources from dynamics you can right click on your folder and choose "" and then follow the instructions.

<img src="https://user-images.githubusercontent.com/22397350/139916084-ede34b40-e418-4009-9cf3-9a2028dfb290.png" alt="drawing" width="400"/>

**NamingConvention** 

`WebResourceFolder`: The folder(s) in which your webresources are located. Use paths from the source workspace folder. No need to add the last "/". <br/>
`Prefix`: The prefix that will be added to your webresource when you upload it. You can use more than one but you need to select the correct one each time. <br/>

**OrgInfo**

`CrmUrl`: your environments url. Don't use the "/" at the end. <br/>
`ApiVersion`: The api version in your dynamics. This is 9.1 by default. <br/>

**Solutions**

This is an array of the uniquenames for your solutions. <br/>
You will be prompted to choose one of the solution to export. Exporting multiple solutions is not supported at the moment. <br/>
If you do not include this option in your json the extension will get every unmanaged solution in your system for you to select.<br/>

*Sample*

```
{
    "NamingConvention" : {
        "WebResourceFolder" : [ "/JsFoler1/path", "/Jsfolder2/path" ],
        "Prefix" : [ "new_/CustomJsFolder/", "new_" ]
    },
    "OrgInfo" : {
        "CrmUrl" : "https://yourorganization.yourregion.dynamics.com",
        "ApiVersion" : "9.1"
    },
    "UploadOptions" : {
        "AddExistingToSolution" : false
    },
    "Solutions" : [ "MyCustomizationSolution", "MyPluginSolution" ]
}
```

**UploadOptions**

`AddExistingToSolution`: if you set this to true, it will ask you if you want to add the webresource to a solution even if it already exists. Otherwise it will just ask you if you create a new one. <br/>

## Supported files

* Webpage (.html)
* Style Sheet (.css)
* Script (.js)
* Data (.xml)
* PNG format (.png)
* JPG format (jpg, .jpeg)
* GIF format (.gif)
* Silverlight (.xap)
* Style Sheet (.xsl)
* ICO format (.ico)
* Vector format (.svg)
* String (.resx)

## Known Issues

Errorhandling isn't aways giving feedback to the user. Will be corrected. If you experience an error please create an issue on the github page or message the author.

## Release Notes

### 0.7.0 - Added Export Solution functionality

Added context menu to export dynamics solution

### 0.6.2

Updated version for the marketplace

### 0.6.1

Marketplace infos added

### 0.6.0

Downloading WebResources now possible by right clicking a folder in your project

### 0.5.0

Initial release. Uploading WebResource to Dynamics now possible
