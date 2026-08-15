# Relay protocol version 1

The relay transports binary messages over one WebSocket. All multi-byte
integers are little-endian.

## Frame header

| Offset | Size | Field |
| --- | ---: | --- |
| 0 | 1 | Magic (`0x83`) |
| 1 | 1 | Protocol version (`1`) |
| 2 | 1 | Message type |
| 3 | 1 | Channel (`1` to `4` for socket operations) |
| 4 | 2 | Request identifier |
| 6 | 2 | Payload length |
| 8 | variable | Payload |

The client must first send `HELLO` (`0x01`). The relay answers with `READY`
(`0x81`) carrying a 32-bit feature mask: DNS bit 0, TCP bit 1, UDP bit 2.

## DNS

- `DNS` (`0x10`): UTF-8 hostname.
- `DNS_RESULT` (`0x90`): status byte followed by four IPv4 octets on success.

The request identifier associates the result with the request.

## TCP

- `TCP_OPEN` (`0x20`): flags byte, destination port, UTF-8 host.
- `TCP_OPEN_RESULT` (`0xa0`): status, local IPv4, local port.
- `TCP_SEND` (`0x21`): bytes to write.
- `TCP_DATA` (`0xa1`): bytes received.
- `TCP_CLOSE` (`0x22`): no payload.
- `TCP_CLOSED` (`0xa2`): status byte.

Flag bit 0 requests TCP no-delay. The relay resolves hostnames itself and
connects to the resolved IPv4 address to prevent DNS rebinding between policy
validation and connection setup.

## UDP

- `UDP_OPEN` (`0x30`): requested local port. Version 1 accepts only zero.
- `UDP_OPEN_RESULT` (`0xb0`): status and assigned local port.
- `UDP_SEND` (`0x31`): destination IPv4, destination port, datagram bytes.
- `UDP_DATA` (`0xb1`): source IPv4, source port, datagram bytes.
- `UDP_CLOSE` (`0x32`): no payload.
- `UDP_CLOSED` (`0xb2`): status byte.

Only peers previously contacted by that channel may send datagrams back to the
guest. Unsolicited peers are discarded.

## Status values

| Value | Meaning |
| ---: | --- |
| `0x00` | OK |
| `0x01` | Bad frame |
| `0x02` | Bad opcode |
| `0x03` | Bad length |
| `0x04` | Bad channel |
| `0x05` | No slot |
| `0x06` | Network unavailable |
| `0x07` | Connection failed |
| `0x08` | I/O error |
| `0x09` | Unsupported |
| `0x0a` | Busy |
| `0x0b` | Bad argument |
