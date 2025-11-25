package com.independent.cardcodex.domain

import com.independent.cardcodex.core_database.CardDao
import com.independent.cardcodex.core_database.CardEntity
import javax.inject.Inject

class DeckImportUseCase @Inject constructor(
    private val cardDao: CardDao
) {
    suspend operator fun invoke(input: String): DeckImportResult {
        val lines = input.lines().filter { it.isNotBlank() }
        val foundCards = mutableListOf<ParsedCard>()
        val notFoundLines = mutableListOf<String>()

        // Regex: Quantity | Name | Set | Number
        // Example: 4 Charizard ex MEW 6
        // Group 1: (\d+) - Quantity
        // Group 2: (.+?) - Name (lazy match)
        // Group 3: (\w+) - Set Code (last word before number)
        // Group 4: (\d+) - Number (last digits)
        // This is tricky because Name can contain spaces.
        // Let's try matching from the end.
        // (\d+)\s+(.+)\s+(\w+)\s+(\d+)
        val regex = Regex("""^(\d+)\s+(.+)\s+(\w+)\s+(\d+)$""")

        for (line in lines) {
            val match = regex.find(line.trim())
            if (match != null) {
                val (qtyStr, name, setCode, number) = match.destructured
                val quantity = qtyStr.toIntOrNull() ?: 1
                
                // Try to find exact match
                // We assume cardId is constructed like "set-number" or similar.
                // But the DB has cardId as primary key.
                // The current import logic sets cardId = cardEntry.id.
                // We need to know how cardEntry.id is formatted.
                // In ManifestRepository: set = cardEntry.id.substringBefore("-", "Unknown")
                // So cardId is likely "set-number".
                // But the input has "MEW" and "6". If cardId is "MEW-6", we can try that.
                
                // Note: Set codes in PTCGL export might differ slightly from our ID format.
                // We'll try constructing the ID.
                val potentialId = "$setCode-$number"
                var card = cardDao.getCardById(potentialId)
                
                if (card == null) {
                    // Try fuzzy match by name
                    val cardsByName = cardDao.getCardsByName(name)
                    card = cardsByName.firstOrNull()
                }

                if (card != null) {
                    foundCards.add(ParsedCard(card, quantity))
                } else {
                    notFoundLines.add(line)
                }
            } else {
                // Regex didn't match, maybe try just name?
                // For now, treat as not found.
                notFoundLines.add(line)
            }
        }

        return DeckImportResult(foundCards, notFoundLines)
    }
}

data class ParsedCard(
    val card: CardEntity,
    val quantity: Int
)

data class DeckImportResult(
    val cards: List<ParsedCard>,
    val notFoundLines: List<String>
)
