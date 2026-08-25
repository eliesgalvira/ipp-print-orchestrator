import {
  IppClient,
  type IppMessage,
  type IppRequestMessage,
  makePrinter,
} from "@ipp/ipp"
import { Effect } from "effect"

import { CupsIppProtocolError, CupsIppUnavailable } from "../domain/Errors.js"
import { ippFailureMessage } from "./IppFailureMessage.js"

type IppClientService = Parameters<typeof IppClient.of>[0]

export const makeCupsIppQueueClient = (
  ippClient: IppClientService,
  queueName: string,
) => {
  const uri = `ipp://localhost:631/printers/${encodeURIComponent(queueName)}`
  const printer = makePrinter({
    endpoint: `http://localhost:631/printers/${encodeURIComponent(queueName)}`,
    language: "en",
    uri,
  })

  const request = (
    operation: string,
    message: IppRequestMessage | null,
  ): Effect.Effect<IppMessage, CupsIppUnavailable | CupsIppProtocolError> =>
    printer.execute(operation, message).pipe(
      Effect.provideService(IppClient, ippClient),
      Effect.mapError(
        (error) => new CupsIppUnavailable({ message: String(error) }),
      ),
      Effect.flatMap((response) =>
        response.statusCode === undefined ||
        response.statusCode.startsWith("successful-ok")
          ? Effect.succeed(response)
          : Effect.fail(
              new CupsIppProtocolError({
                message: ippFailureMessage(response, { operation }),
              }),
            ),
      ),
    )

  return { request, uri }
}
