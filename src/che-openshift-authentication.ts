/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as vscode from 'vscode';
import * as che from '@eclipse-che/plugin';
import { spawn } from 'child_process';
import axios, { AxiosInstance } from 'axios';

interface Attributes {
    cluster: string
}

interface Data {
    attributes: Attributes
}

interface OsUserResponse {
    data: Data[]
}

export async function activate(context: vscode.ExtensionContext) {
    const machineToken = process.env['CHE_MACHINE_TOKEN'];
    const isMultiUser = !!(machineToken && machineToken.length > 0);
    const axiosInstance: AxiosInstance = axios;
    const cheApi = process.env['CHE_API'];
    const isHostedChe = cheApi && cheApi.indexOf('https://che.openshift.io/api') !== -1;
    const isLoggedIn: boolean = await isLoggedInFunc();
    if (isLoggedIn) {
        return;
    }
    // getProviders method is not supported for multi-user Mode
    if (isMultiUser) {
        if (!await che.oAuth.isRegistered('openshift-v3') && !await che.oAuth.isRegistered('openshift-v4')) {
            return;
        }
    } else {
        const oAuthProviders = await che.oAuth.getProviders();
        if (oAuthProviders.indexOf('openshift') == -1) {
            return;
        }
    }

    const isAuthenticated: boolean = isMultiUser ? await che.oAuth.isAuthenticated('openshift-v3') ||
        await che.oAuth.isAuthenticated('openshift-v4') : await che.oAuth.isAuthenticated('openshift');

    if (!isAuthenticated) {
        const action = await vscode.window.showWarningMessage(`The OpenShift plugin is not authorized, would you like to authenticate?`, 'Yes', 'No');
        if (action === 'Yes') {
            await ocLogIn();
        }
    } else {
        await ocLogIn();
    }

    function isLoggedInFunc(): Promise<boolean> {
        return new Promise<boolean>(resolve => {
            let result = '';
            const whoamiCommand = spawn('oc', ['whoami']);
            whoamiCommand.stdout.on('data', data => {
                result += data.toString();
            });
            whoamiCommand.stderr.on('data', () => {
                resolve(false);
            });
            whoamiCommand.on('close', () => {
                resolve(!result.includes('system:serviceaccount:'));
            });
        })
    }

    async function ocLogIn(): Promise<void> {
        const errorMessage = 'Failed to authenticated the OpenShift connector plugin: ';
        let error = '';
        let server = '';
        let token = '';
        try {
            server = await getServerUrl();
            token = await che.openshift.getToken();
        } catch (e) {
            vscode.window.showErrorMessage(errorMessage + e);
            return;
        }
        const args = ['login', server, '--token', token];
        if (!isHostedChe) {
            args.push('--certificate-authority=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
        }
        const osCommand = spawn('oc', args);
        osCommand.stderr.on('data', data => {
            error += data
        });
        osCommand.on('close', (code: number | null) => {
            code = code === null ? 0 : code;
            if (code === 0) {
                if (isAuthenticated) {
                    return;
                }
                vscode.window.showInformationMessage('OpenShift connector plugin is successfully authenticated');
            } else {
                vscode.window.showErrorMessage(errorMessage + error);
            }
        });
    }

    function getServerUrl(): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
            if (isHostedChe) {
                const user = await che.user.getCurrentUser();
                const osUserResponse = await axiosInstance.get<OsUserResponse>('https://api.openshift.io/api/users?filter[username]=' + user.name);
                resolve(osUserResponse.data.data[0].attributes.cluster);
                return;
            }
            let result = '';
            const versionCommand = spawn('odo', ['version']);
            // tslint:disable-next-line:no-any
            versionCommand.stdout.on('data', data => {
                result += data.toString();
            });
            // tslint:disable-next-line:no-any
            versionCommand.stderr.on('data', data => {
                reject(data)
            });
            versionCommand.on('close', () => {
                const match = result.match(/https?:\/\/(www.)?[-a-zA-Z0-9.[a-z]([-a-zA-Z0-9@:%_+.~#?&/=]*)/g);
                if (match && match.length === 1) {
                    resolve(match[0]);
                } else {
                    reject('Failed to get the server url');
                }
            });
        })
    }
}
