import * as vscode from "vscode";
import { useIdentityPlugin } from "@azure/identity";
import { vsCodePlugin } from "@azure/identity-vscode";

useIdentityPlugin(vsCodePlugin);

export class ConnectionHandler {

}