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

Then you need to configure the json so you can upload the webresource. The target is that you only need to do this once.

After that:

You can call the upload command via the command palette in vs code. Search for "Dynamics-For-Dev: Upload WebResource" and follow the instructions.
Alternatively you can right click a supported file (See [Supported Files](#supported-files)) and use the "Upload to Dynamics" command in the context menu.

**NamingConvention** 

`WebResourceFolder`: The folder(s) in which your webresources are located. Use paths from the source workspace folder. No need to add the last "/". <br/>
`Prefix`: The prefix that will be added to your webresource when you upload it. You can use more than one but you need to select the correct one each time. <br/>

**OrgInfo**

`CrmUrl`: your environments url. Don't use the "/" at the end. <br/>
`ApiVersion`: The api version in your dynamics. This is 9.1 by default. <br/>

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
    }
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

Errorhandling isn't aways giving feedback to the user. Will be corrected.

## Release Notes

### 0.5.0

Initial release. Uplaoding WebResource to Dynamics now possible
