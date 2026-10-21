package sk.zdravie.app.data

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.CharacterCodingException

/** Android's JSONObject accepts non-JSON syntax; validate the wire format before using it. */
internal object StrictJson {
    fun objectValue(bytes: ByteArray): JSONObject {
        val text = try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: CharacterCodingException) { throw IllegalArgumentException("Invalid UTF-8") }
        return objectValue(text)
    }

    fun objectValue(text: String): JSONObject {
        Reader(text).validate()
        return JSONObject(text)
    }

    private class Reader(private val text: String) {
        private var position = 0

        fun validate() {
            whitespace()
            require(peek() == '{')
            value(0)
            whitespace()
            require(position == text.length)
        }

        private fun value(depth: Int) {
            require(depth <= 64)
            whitespace()
            when (peek()) {
                '{' -> {
                    position++
                    whitespace()
                    val keys = HashSet<String>()
                    if (take('}')) return
                    do {
                        whitespace()
                        require(peek() == '"')
                        require(keys.add(string()))
                        whitespace()
                        require(take(':'))
                        value(depth + 1)
                        whitespace()
                        if (take('}')) return
                        require(take(','))
                    } while (true)
                }
                '[' -> {
                    position++
                    whitespace()
                    if (take(']')) return
                    do {
                        value(depth + 1)
                        whitespace()
                        if (take(']')) return
                        require(take(','))
                    } while (true)
                }
                '"' -> string()
                't' -> literal("true")
                'f' -> literal("false")
                'n' -> literal("null")
                '-', in '0'..'9' -> number()
                else -> error("Invalid JSON")
            }
        }

        private fun string(): String {
            require(take('"'))
            val result = StringBuilder()
            while (true) {
                val character = peek() ?: error("Invalid JSON string")
                position++
                when (character) {
                    '"' -> break
                    '\\' -> {
                        val escape = peek() ?: error("Invalid JSON escape")
                        position++
                        result.append(when (escape) {
                            '"', '\\', '/' -> escape
                            'b' -> '\b'; 'f' -> '\u000c'; 'n' -> '\n'; 'r' -> '\r'; 't' -> '\t'
                            'u' -> {
                                require(position + 4 <= text.length)
                                val hex = text.substring(position, position + 4)
                                require(hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' })
                                position += 4
                                hex.toInt(16).toChar()
                            }
                            else -> error("Invalid JSON escape")
                        })
                    }
                    else -> { require(character >= ' '); result.append(character) }
                }
            }
            var index = 0
            while (index < result.length) {
                val character = result[index++]
                if (Character.isHighSurrogate(character)) {
                    require(index < result.length && Character.isLowSurrogate(result[index++]))
                } else require(!Character.isLowSurrogate(character))
            }
            return result.toString()
        }

        private fun number() {
            val start = position
            take('-')
            if (!take('0')) {
                require(peek() in '1'..'9')
                while (peek() in '0'..'9') position++
            }
            if (take('.')) {
                require(peek() in '0'..'9')
                while (peek() in '0'..'9') position++
            }
            if (peek() == 'e' || peek() == 'E') {
                position++
                if (peek() == '+' || peek() == '-') position++
                require(peek() in '0'..'9')
                while (peek() in '0'..'9') position++
            }
            require(text.substring(start, position).toDouble().isFinite())
        }

        private fun literal(value: String) {
            require(text.startsWith(value, position))
            position += value.length
        }

        private fun whitespace() {
            while (peek() == ' ' || peek() == '\t' || peek() == '\r' || peek() == '\n') position++
        }
        private fun peek(): Char? = text.getOrNull(position)
        private fun take(character: Char): Boolean = if (peek() == character) { position++; true } else false
    }
}
