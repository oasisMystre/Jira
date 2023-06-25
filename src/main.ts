import { v4 as uuid } from "uuid";

import { io, type Socket } from "socket.io-client";

import type { Method, Response } from "./types/response";

let client: Socket;

export const createClient = (...options: Parameters<typeof io>) =>
  (client = io(...options));

type Callable<T extends any = any> = (response: T) => void;

type RequestOptions = {
  data?: object;
  query?: object;
  method: Method;
  action: string;
};

type Listener<T> = Record<Method, Record<string, T>>;

const listeners: Listener<Record<string, Callable[]> | Callable[]> = {
  GET: {},
  POST: {},
  PUT: {},
  PATCH: {},
  DELETE: {},
  SUBSCRIPTION: {},
};

export const emit = <T>(
  event: string,
  options: RequestOptions,
  listener: Callable<T>[] | Callable<T>,
  requestId: string = uuid()
) => {
  switch (options.method) {
    case "SUBSCRIPTION":
      if (!listeners[options.method][options.action])
        listeners[options.method][options.action] = [];

      (listeners[options.method][options.action] as Callable[]).push(
        listener as Callable<T>
      );
      break;
    default:
      if (!listeners[options.method][options.action])
        listeners[options.method][options.action] = {};

      (listeners[options.method][options.action] as Record<string, Callable[]>)[
        requestId
      ] = listener as Callable[];
  }
  if (!client.hasListeners(event))
    client.on(event, (response: Response<T>) => {
      switch (response.method) {
        case "SUBSCRIPTION":
          const subscriptions = listeners[response.method][response.action] as
            | Callable[]
            | null;

          if (subscriptions)
            subscriptions.map((subscription) => subscription(response));
          break;
        default:
          const listener: Callable<Response<T>>[] | null = (
            listeners[response.method][response.action] as Record<
              string,
              Callable[]
            >
          )[response.requestId];
          if (listener) {
            const [success, error] = listener;
            if (Math.floor(response.status / 100) === 2) success(response);
            else error(response);
          }
      }
    });

  client.emit(event, {
    requestId,
    method: options.method,
    data: options.data || {},
    query: options.query || {},
    action: options.action,
  });

  return {
    cancel() {
      switch (options.method) {
        case "SUBSCRIPTION":
          if (listeners[options.method][options.action])
            delete listeners[options.method][options.action];
          break;
        default:
          if (
            (
              listeners[options.method][options.action] as Record<
                string,
                Callable[]
              >
            )[requestId]
          )
            delete (
              listeners[options.method][options.action] as Record<
                string,
                Callable[]
              >
            )[requestId];
      }
    },
  };
};

export const request = <T>(event: string, options: RequestOptions) =>
  new Promise<Response<T>>((resolve, reject) => {
    const { cancel } = emit(event, options, [
      (response: Response<T>) => {
        resolve(response);
        cancel();
      },
      reject,
    ]);
  });

type RequestOption = {
  data?: object;
  query?: object;
  action: string;
};

export const subscribe = <T>(
  event: string,
  options: RequestOption,
  listener: Callable<T>
) => {
  emit(event, { ...options, method: "SUBSCRIPTION" }, listener);
};

type ListenOptions<T> = {
  selector: (data: any) => any;
  selectors: (response: Response<T>, selector: (data: any) => any) => any[];
} & RequestOptions;

export const listen = <T>(
  requestP: ReturnType<typeof request<T>>,
  event: string,
  options: ListenOptions<T>,
  listener: Callable<Response<T>>
) => {
  return requestP.then((response) => {
    const subscribing_pks = options.selectors(response, options.selector);

    return subscribe(event, options, (response: Response<T>) => {
      if (options.selector(response.data) in subscribing_pks)
        listener(response);
    });
  });
};

export class Jira {
  readonly post = <T>(event: string, options: RequestOption) =>
    request<T>(event, { ...options, method: "POST" });

  readonly get = <T>(event: string, options: RequestOption) =>
    request<T>(event, {
      ...options,
      method: "GET",
    });

  readonly put = <T>(event: string, options: RequestOption) =>
    request<T>(event, {
      ...options,
      method: "PUT",
    });

  readonly patch = <T>(event: string, options: RequestOption) =>
    request<T>(event, {
      ...options,
      method: "PATCH",
    });

  readonly delete = <T>(event: string, options: RequestOption) =>
    request<T>(event, {
      ...options,
      method: "DELETE",
    });
}