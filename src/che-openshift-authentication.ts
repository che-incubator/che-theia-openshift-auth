/*********************************************************************
 * Copyright (c) 2020 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import * as theia from '@theia/plugin';
import * as che from '@eclipse-che/plugin';
import { spawn } from 'child_process';

export async function start(context: theia.PluginContext) {
    const machineToken = process.env['CHE_MACHINE_TOKEN'];
    const isMultiUser = !!(machineToken && machineToken.length > 0);
    // getProviders method is not supported for multi-user Mode
    if (isMultiUser) {
        if (!await che.oAuth.isRegistered('openshift-v3') || !await che.oAuth.isRegistered('openshift-v4')) {
            return
        }
    } else {
        const oAuthProviders = await che.oAuth.getProviders();
        if (oAuthProviders.indexOf('openshift') == -1) {
            return;
        }
    }

    const isLoggedIn: boolean = await isLoggedInFunc();
    const isAuthenticated: boolean = await che.oAuth.isAuthenticated('openshift');

    if (!isLoggedIn && !isAuthenticated) {
        const action = await theia.window.showWarningMessage(`The OpenShift plugin is not authorized, would you like to authenticate?`, 'Yes', 'No');
        if (action == 'Yes') {
            await ocLogIn();
        }
    } else if (!isLoggedIn) {
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
                resolve(!result.includes('system:serviceaccount:che:che-workspace'));
            });
        })
    }

    async function ocLogIn(): Promise<void> {
        let error = '';
        const server = await getServerUrl();
        const token = await che.openshift.getToken();
        const osCommand = spawn('oc', ['login', server, '--certificate-authority=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', '--token', token]);
        osCommand.stderr.on('data', data => {
            error += data
        });
        osCommand.on('close', (code: number | null) => {
            code = code === null ? 0 : code;
            if (code === 0) {
                if (isAuthenticated) {
                    return;
                }
                theia.window.showInformationMessage('OpenShift connector plugin is successfully authenticated');
            } else {
                theia.window.showErrorMessage('Failed to authenticated the OpenShift connector plugin: ' + error);
            }
        });
    }

    function getServerUrl(): Promise<string> {
        return new Promise<string>(resolve => {
            let result = '';
            const versionCommand = spawn('odo', ['version']);
            // tslint:disable-next-line:no-any
            versionCommand.stdout.on('data', (data: any) => {
                result += data.toString();
            });
            // tslint:disable-next-line:no-any
            versionCommand.stderr.on('data', (data: any) => {
                resolve('');
            });
            versionCommand.on('close', (code: number | null) => {
                const server: string = result.substring(result.indexOf('Server: ') + 8, result.indexOf('Kubernetes: ') - 1);
                resolve(server);
            });
        })
    }
}

export function stop() {

}
