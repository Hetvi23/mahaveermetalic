import { PropsWithChildren } from 'react';
import { FrappeApp, FrappeAuth, FrappeCall } from 'frappe-js-sdk';
import { FrappeDB } from 'frappe-js-sdk/lib/db';
import { FrappeFileUpload } from 'frappe-js-sdk/lib/file';
import { Error } from 'frappe-js-sdk/lib/frappe_app/types';
import { Filter, FrappeDoc, GetDocListArgs } from 'frappe-js-sdk/lib/db/types';
import { default as useSWR, Key, SWRConfiguration, SWRResponse, useSWRConfig, preload } from 'swr';
import { default as useSWRInfinite } from 'swr/infinite';
import { FileArgs } from 'frappe-js-sdk/lib/file/types';
import { Socket } from 'socket.io-client';
import { AuthCredentials, AuthResponse, OTPCredentials, UserPassCredentials } from 'frappe-js-sdk/lib/auth/types';
export type { SWRConfiguration, SWRResponse, Key };
export { useSWR, useSWRConfig, useSWRInfinite, preload };
export type { OTPCredentials, UserPassCredentials, AuthCredentials, AuthResponse, FrappeDoc, GetDocListArgs, Filter, FileArgs, Error as FrappeError };
export interface FrappeConfig {
    /** The URL of your Frappe server */
    url: string;
    tokenParams?: TokenParams;
    app: FrappeApp;
    auth: FrappeAuth;
    db: FrappeDB;
    call: FrappeCall;
    file: FrappeFileUpload;
    socket?: Socket;
}
export interface TokenParams {
    /** Whether to use token for API calls */
    useToken: boolean;
    /** Function that returns the token as a string - this could be fetched from LocalStorage or auth providers like Firebase, Auth0 etc. */
    token?: () => string;
    /** Type of token to be used for authentication */
    type: 'Bearer' | 'token';
}
export declare const FrappeContext: import('react').Context<FrappeConfig | null>;
declare type FrappeProviderProps = PropsWithChildren<{
    /** URL of the Frappe server
     *
     * Only needed if the URL of the window is not the same as the Frappe server URL */
    url?: string;
    /** Token parameters to be used for authentication
     *
     * Only needed for token based authentication */
    tokenParams?: TokenParams;
    /** Port on which Socket is running. Only meant for local development. Set to undefined on production. */
    socketPort?: string;
    /** Get this from frappe.local.site on the server, or frappe.boot.sitename on the window.
     * Required for Socket connection to work in Frappe v15+
     */
    siteName?: string;
    /** Flag to disable socket, if needed. This defaults to true. */
    enableSocket?: boolean;
    /** SWR Configuration options - these will be applied globally unless overridden */
    swrConfig?: SWRConfiguration;
    /** Custom Headers to be passed in each request */
    customHeaders?: object;
}>;
export declare const FrappeProvider: ({ url, tokenParams, socketPort, swrConfig, siteName, enableSocket, children, customHeaders }: FrappeProviderProps) => import("react/jsx-runtime").JSX.Element;
/**
 * Hook to start listening to user state and provides functions to login/logout
 *
 * @param options - [Optional] SWRConfiguration options for fetching current logged in user
 * @returns Returns an object with the following properties: currentUser, loading, error, and functions to login, logout and updateCurrentUser
 */
export declare const useFrappeAuth: (options?: SWRConfiguration) => {
    /** The current logged in user. Will be null/undefined if user is not logged in */
    currentUser: string | null | undefined;
    /** Will be true when the hook is fetching user data  */
    isLoading: boolean;
    /** Will be true when the hook is fetching (or revalidating) the user state. (Refer to isValidating in useSWR)  */
    isValidating: boolean;
    /** Error object returned from API call */
    error: Error | null | undefined;
    /** Function to login the user with email and password */
    login: (credentials: AuthCredentials) => Promise<AuthResponse>;
    /** Function to log the user out */
    logout: () => Promise<any>;
    /** Function to fetch updated user state */
    updateCurrentUser: () => void;
    /** Function to get the user cookie and */
    getUserCookie: () => void;
};
export declare const getRequestURL: (doctype: string, url: string, docname?: string | null) => string;
/**
 * Hook to fetch a document from the database
 *
 *
 * @param doctype - The doctype to fetch
 * @param name - the name of the document to fetch
 * @param options [Optional] SWRConfiguration options for fetching data
 * @returns an object (SWRResponse) with the following properties: data, error, isValidating, and mutate
 *
 * @typeParam T - The type of the document
 *
 * @example
 *
 * const { data, error, isLoading, mutate } = useFrappeGetDoc("User", "test")
 *
 * if (isLoading) {
 *      return <div>Loading...</div>
 * }
 *
 * if (error) {
 *      return <div>Error: {error.message}</div>
 * }
 *
 * return <div>{data?.name} - {data?.email}</div>
 */
export declare const useFrappeGetDoc: <T = any>(doctype: string, name?: string, swrKey?: Key, options?: SWRConfiguration) => SWRResponse<FrappeDoc<T>, Error, any>;
/**
 * Hook to prefetch a document from the database
 * @param doctype - The doctype to fetch
 * @param name - The name of the document to fetch
 * @param swrKey - The SWRKey to use for caching the result - optional
 * @param options - The SWRConfiguration options for fetching data
 * @returns A function to prefetch the document
 *
 * @example
 *
 * const preloadDoc = useFrappePrefetchDoc("User", "test@example.com")
 *
 * // Call the function when you want to prefetch the document
 * const onHover = () => {
 *      preloadDoc()
 * }
 */
export declare const useFrappePrefetchDoc: <T = any>(doctype: string, name?: string, swrKey?: Key, options?: SWRConfiguration) => () => void;
/**
 * Function that returns a query string for all arguments passed to getDocList function
 * @param args - The arguments to pass to the getDocList method
 * @returns query string to be appended to the url for the API call
 */
export declare const getDocListQueryString: (args?: GetDocListArgs) => string;
/**
 * Hook to fetch a list of documents from the database
 *
 * @param doctype Name of the doctype to fetch
 * @param args Arguments to pass (filters, pagination, etc)
 * @param options [Optional] SWRConfiguration options for fetching data
 * @returns an object (SWRResponse) with the following properties: data, error, isValidating, and mutate
 *
 * @typeParam T - The type definition of the document object
 *
 * @example
 *
 * const { data, error, isLoading, mutate } = useFrappeGetDocList("User")
 *
 * if (isLoading) {
 *      return <div>Loading...</div>
 * }
 *
 * if (error) {
 *      return <div>Error: {error.message}</div>
 * }
 *
 * return <ul>{data?.map((user) => <li key={user.name}>{user.name}</li>)}</ul>
 *
 */
export declare const useFrappeGetDocList: <T = any, K = FrappeDoc<T>>(doctype: string, args?: GetDocListArgs<K> | undefined, swrKey?: Key, options?: SWRConfiguration) => SWRResponse<T[], Error, SWRConfiguration<T[], Error, import('swr/dist/_internal/types').BareFetcher<T[]>> | undefined>;
/**
 * Hook to prefetch a list of documents from the database
 * @param doctype - The doctype to fetch
 * @param args - The arguments to pass to the getDocList method
 * @param swrKey - The SWRKey to use for caching the result - optional
 * @returns A function to prefetch the list of documents
 *
 * @example
 *
 * const preloadList = useFrappePrefetchDocList("User")
 *
 * // Call the function when you want to prefetch the list
 * const onHover = () => {
 *      preloadList()
 * }
 */
export declare const useFrappePrefetchDocList: <T = any, K = FrappeDoc<T>>(doctype: string, args?: GetDocListArgs<K> | undefined, swrKey?: Key) => () => void;
/**
 * Hook to create a document in the database and maintain loading and error states
 * @returns Object with the following properties: loading, error, isCompleted and createDoc and reset functions
 *
 * @example
 *
 * const { createDoc, loading, error, isCompleted, reset } = useFrappeCreateDoc()
 *
 * const onSubmit = async () => {
 *      const doc = await createDoc("User", { name: "John Doe", email: "john.doe@example.com" })
 * }
 */
export declare const useFrappeCreateDoc: <T = any>() => {
    /** Function to create a document in the database */
    createDoc: (doctype: string, doc: T) => Promise<FrappeDoc<T>>;
    /** Will be true when the API request is pending.  */
    loading: boolean;
    /** Error object returned from API call */
    error: Error | null | undefined;
    /** Will be true if document is created. Else false */
    isCompleted: boolean;
    /** Function to reset the state of the hook */
    reset: () => void;
};
/**
 * Hook to update a document in the database and maintain loading and error states
 * @returns Object with the following properties: loading, error, isCompleted and updateDoc and reset functions
 *
 * @example
 *
 * const { updateDoc, loading, error, isCompleted, reset } = useFrappeUpdateDoc()
 *
 * const onSubmit = async () => {
 *      const doc = await updateDoc("User", "test@example.com", { name: "John Doe", email: "john.doe@example.com" })
 * }
 */
export declare const useFrappeUpdateDoc: <T = any>() => {
    /** Function to update a document in the database */
    updateDoc: (doctype: string, docname: string | null, doc: Partial<T>) => Promise<FrappeDoc<T>>;
    /** Will be true when the API request is pending.  */
    loading: boolean;
    /** Error object returned from API call */
    error: Error | null | undefined;
    /** Will be true if document is created. Else false */
    isCompleted: boolean;
    /** Function to reset the state of the hook */
    reset: () => void;
};
/**
 * Hook to delete a document in the database and maintain loading and error states
 * @returns Object with the following properties: loading, error, isCompleted and deleteDoc and reset functions
 *
 * @example
 *
 * const { deleteDoc, loading, error, isCompleted, reset } = useFrappeDeleteDoc()
 *
 * const onDelete = async () => {
 *      const message = await deleteDoc("User", "test@example.com")
 * }
 */
export declare const useFrappeDeleteDoc: () => {
    /** Function to delete a document in the database. Returns a promise which resolves to an object with message "ok" if successful */
    deleteDoc: (doctype: string, docname?: string | null) => Promise<{
        message: string;
    }>;
    /** Will be true when the API request is pending.  */
    loading: boolean;
    /** Error object returned from API call */
    error: Error | null | undefined;
    /** Will be true if document is created. Else false */
    isCompleted: boolean;
    /** Function to reset the state of the hook */
    reset: () => void;
};
/**
 * Hook to fetch number of documents from the database
 *
 *
 * @param doctype - The doctype to fetch
 * @param filters - filters to apply to the query
 * @param debug - Whether to log debug messages or not. Defaults to false
 * @param options [Optional] SWRConfiguration options for fetching data
 * @returns an object (SWRResponse) with the following properties: data (number), error, isValidating, and mutate
 *
 * @example
 *
 * const { data, error, isLoading, mutate } = useFrappeGetDocCount("User")
 *
 */
export declare const useFrappeGetDocCount: <T = any>(doctype: string, filters?: Filter<T>[] | undefined, debug?: boolean, swrKey?: Key, options?: SWRConfiguration) => SWRResponse<number, Error>;
/**
 * Hook to prefetch the number of documents from the database
 * @param doctype - The doctype to fetch
 * @param filters - filters to apply to the query
 * @param debug - Whether to log debug messages or not. Defaults to false
 * @param swrKey - The SWRKey to use for caching the result - optional
 * @returns A function to prefetch the number of documents
 *
 * @example
 *
 * const preloadCount = useFrappePrefetchDocCount("User")
 *
 * // Call the function when you want to prefetch the count
 * const onHover = () => {
 *      preloadCount()
 * }
 */
export declare const useFrappePrefetchDocCount: <T = any>(doctype: string, filters?: Filter<T>[] | undefined, debug?: boolean, swrKey?: Key) => () => void;
/**
 *  Hook to make a GET request to the server
 *
 * @param method - name of the method to call (will be dotted path e.g. "frappe.client.get_list")
 * @param params - parameters to pass to the method
 * @param swrKey - optional SWRKey that will be used to cache the result. If not provided, the method name with the URL params will be used as the key
 * @param options [Optional] SWRConfiguration options for fetching data
 * @param type - type of the request to make - defaults to GET
 *
 * @typeParam T - Type of the data returned by the method
 * @returns an object (SWRResponse) with the following properties: data (number), error, isValidating, isLoading, and mutate
 *
 * @example
 *
 * const { data, error, isLoading, mutate } = useFrappeGetCall("ping")
 *
 */
export declare const useFrappeGetCall: <T = any>(method: string, params?: Record<string, any>, swrKey?: Key, options?: SWRConfiguration, type?: 'GET' | 'POST') => SWRResponse<T, Error, any>;
/**
 * Hook to prefetch a GET request to the server
 * @param method - name of the method to call (will be dotted path e.g. "frappe.client.get_list")
 * @param params - parameters to pass to the method
 * @param swrKey - optional SWRKey that will be used to cache the result. If not provided, the method name with the URL params will be used as the key
 * @param type - type of the request to make - defaults to GET
 * @returns A function to prefetch the GET request
 *
 * @example
 * const preload = useFrappePrefetchCall('ping')
 *
 * // Call the function when you want to prefetch the GET request
 * const onHover = () => {
 *      preload()
 * }
 */
export declare const useFrappePrefetchCall: <T = any>(method: string, params?: Record<string, any>, swrKey?: Key, type?: 'GET' | 'POST') => () => void;
/**
 *
 * @param method - name of the method to call (POST request) (will be dotted path e.g. "frappe.client.set_value")
 * @returns an object with the following properties: loading, error, isCompleted , result, and call and reset functions
 *
 * @example
 *
 * const { call, result, loading, error, isCompleted, reset } = useFrappePostCall("frappe.client.set_value")
 *
 * const onSubmit = async () => {
 *      const message = await call({ doctype: "User", docname: "test@example.com", fieldname: "full_name", value: "John Doe" })
 * }
 *
 */
export declare const useFrappePostCall: <T = any>(method: string) => {
    /** Function to call the method. Returns a promise which resolves to the data returned by the method */
    call: (params: Record<string, any>) => Promise<T>;
    /** The result of the API call */
    result: T | null;
    /** Will be true when the API request is pending.  */
    loading: boolean;
    /** Error object returned from API call */
    error: Error | null;
    /** Will be true if API call is successful. Else false */
    isCompleted: boolean;
    /** Function to reset the state of the hook */
    reset: () => void;
};
/**
 *
 * @param method - name of the method to call (PUT request) (will be dotted path e.g. "frappe.client.set_value")
 * @returns an object with the following properties: loading, error, isCompleted , result, and call and reset functions
 *
 * @example
 *
 * const { call, result, loading, error, isCompleted, reset } = useFrappePutCall("frappe.client.set_value")
 *
 * const onSubmit = async () => {
 *      const message = await call({ doctype: "User", docname: "test@example.com", fieldname: "full_name", value: "John Doe" })
 * }
 */
export declare const useFrappePutCall: <T = any>(method: string) => {
    /** Function to call the method. Returns a promise which resolves to the data returned by the method */
    call: (params: Record<string, any>) => Promise<T>;
    /** The result of the API call */
    result: T | null;
    /** Will be true when the API request is pending.  */
    loading: boolean;
    /** Error object returned from API call */
    error: Error | null;
    /** Will be true if API call is successful. Else false */
    isCompleted: boolean;
    /** Function to reset the state of the hook */
    reset: () => void;
};
/**
 *
 * @param method - name of the method to call (DELETE request) (will be dotted path e.g. "frappe.client.delete")
 * @returns an object with the following properties: loading, error, isCompleted , result, and call and reset functions
 *
 * @example
 *
 * const { call, result, loading, error, isCompleted, reset } = useFrappeDeleteCall("frappe.client.delete")
 *
 * const onSubmit = async () => {
 *      const message = await call({ doctype: "User", docname: "test@example.com" })
 * }
 */
export declare const useFrappeDeleteCall: <T = any>(method: string) => {
    /** Function to call the method. Returns a promise which resolves to the data returned by the method */
    call: (params: Record<string, any>) => Promise<T>;
    /** The result of the API call */
    result: T | null;
    /** Will be true when the API request is pending.  */
    loading: boolean;
    /** Error object returned from API call */
    error: Error | null;
    /** Will be true if API call is successful. Else false */
    isCompleted: boolean;
    /** Function to reset the state of the hook */
    reset: () => void;
};
export interface FrappeFileUploadResponse {
    /** Name of the file documnet in the database */
    "name": string;
    "owner": string;
    "creation": string;
    "modified": string;
    "modified_by": string;
    "docstatus": 0 | 1 | 2;
    "idx": number;
    /** Name of the uploaded file */
    "file_name": string;
    /** File is not accessible by guest users */
    "is_private": 1 | 0;
    "is_home_folder": 0 | 1;
    "is_attachments_folder": 0 | 1;
    /** File size in bytes */
    "file_size": number;
    /** Path of the file ex: /private/files/file_name.jpg  */
    "file_url": string;
    "folder": string;
    "is_folder": 0 | 1;
    /** Doctype the file is linked to */
    "attached_to_doctype": string;
    /** Document the file is linked to */
    "attached_to_name": string;
    "content_hash": string;
    "uploaded_to_dropbox": 0 | 1;
    "uploaded_to_google_drive": 0 | 1;
    "doctype": "File";
}
interface UseFrappeFileUploadReturnType<T = any> {
    /** Function to upload the file */
    upload: (file: File, args: FileArgs<T>, apiPath?: string) => Promise<FrappeFileUploadResponse>;
    /** Upload Progress in % - rounded off */
    progress: number;
    /** Will be true when the file is being uploaded  */
    loading: boolean;
    /** Error object returned from API call */
    error: Error | null;
    /** Will be true if file upload is successful. Else false */
    isCompleted: boolean;
    /** Function to reset the state of the hook */
    reset: () => void;
}
/**
 * Hook to upload files to the server
 *
 * @returns an object with the following properties: loading, error, isCompleted , result, and call and reset functions
 *
 * @example
 *
 * const { upload, progress, loading, error, isCompleted, reset } = useFrappeFileUpload()
 *
 * const onSubmit = async () => {
 *      const message = await upload(myFile, { doctype: "User", docname: "test@example.com", fieldname: "profile_pic", is_private: 1 })
 * }
 */
export declare const useFrappeFileUpload: <T = any>() => UseFrappeFileUploadReturnType<T>;
export interface SearchResult {
    value: string;
    label: string;
    description: string;
}
/**
 * Hook to search for documents - only works with Frappe v15+
 *
  * @param doctype - name of the doctype (table) where we are performing our search
  * @param text - search text
  * @param filters - (optional) the results will be filtered based on these
  * @param limit - (optional) the number of results to return. Defaults to 20
  * @param debounce - (optional) the number of milliseconds to wait before making the API call. Defaults to 250ms.
  * @returns result - array of type SearchResult with a list of suggestions based on search text
  *
  * @example
  *
  * const [searchText, setSearchText] = useState("")
  * const { data, error, isLoading, mutate } = useSearch("User", searchText)
  */
export declare const useSearch: (doctype: string, text: string, filters?: Filter[], limit?: number, debounce?: number) => SWRResponse<{
    message: SearchResult[];
}, Error, any>;
/** useFrappeEventListener hook for listening to events from the server
 * @param eventName - name of the event to listen to
 * @param callback - callback function to be called when the event is triggered. The callback function will receive the data sent from the server. It is recommended to memoize this function.
 *
 * @example
 * ```typescript
 * useFrappeEventListener('my_event', (data) => {
 *     // do something with the data
 *      if(data.status === 'success') {
 *          console.log('success')
 *      }
 * })
 * ```
 */
export declare const useFrappeEventListener: <T = any>(eventName: string, callback: (eventData: T) => void) => void;
export interface ViewerEventData {
    doctype: string;
    docname: string;
    users: string[];
}
export interface DocumentUpdateEventData {
    doctype: string;
    name: string;
    modified: string;
}
/**
 * Hook for listening to document events.
 * The hook will automatically subscribe to the document room, and unsubscribe when the component unmounts.
 * The hook listens to the following events:
 * - doc_update: This is triggered when the document is updated. The callback function will receive the updated document.
 * - doc_viewers: This is triggered when the list of viewers of the document changes. The hook will update the viewers state with the list of viewers.
 *
 * @param doctype Name of the doctype
 * @param docname Name of the document
 * @param emitOpenCloseEventsOnMount [Optional] If true, the hook will emit doc_open and doc_close events on mount and unmount respectively. Defaults to true.
 * @param onUpdateCallback Function to be called when the document is updated. It is recommended to memoize this function.
 * @returns viewers - array of userID's, emitDocOpen - function to emit doc_open event, emitDocClose - function to emit doc_close event
 */
export declare const useFrappeDocumentEventListener: (doctype: string, docname: string, onUpdateCallback: (eventData: DocumentUpdateEventData) => void, emitOpenCloseEventsOnMount?: boolean) => {
    /** Array of user IDs of users currently viewing the document. This is updated when "doc_viewers" event is published */
    viewers: string[];
    /** Emit doc_open event - this will explicitly send a doc_open event to the server. */
    emitDocOpen: () => void;
    /** Emit doc_close event - this will explicitly send a doc_close event to the server. */
    emitDocClose: () => void;
};
export interface DocTypeListUpdateEventData {
    doctype: string;
    name: string;
    user: string;
}
/**
 * Hook for listening to doctype events.
 * The hook will automatically subscribe to the doctype room, and unsubscribe when the component unmounts.
 * The hook listens to the following event:
 * - list_update: This is triggered when a document of the doctype is updated (created, modified or deleted). The callback function will receive the updated document.
 *
 * @param doctype Name of the doctype
 * @param onListUpdateCallback Function to be called when the document is updated. It is recommended to memoize this function.
 */
export declare const useFrappeDocTypeEventListener: (doctype: string, onListUpdateCallback: (eventData: DocTypeListUpdateEventData) => void) => void;
