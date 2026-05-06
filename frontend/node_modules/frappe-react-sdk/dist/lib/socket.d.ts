import { Socket } from 'socket.io-client';
import { TokenParams } from '.';
/** Socket class
 * @param url [Optional] url to connect to
 * @param socket_port [Optional] port to connect to
 * @returns socket object
 *
 * if url is not provided, it will be set to the current host and require socket_port
 * if socket_port is not provided, it will be set to 9000
*/
export declare class SocketIO {
    private socket_port;
    private host;
    private port;
    private protocol;
    private url;
    private site_name;
    socket: Socket;
    constructor(url?: string, site_name?: string, socket_port?: string, tokenParams?: TokenParams);
}
