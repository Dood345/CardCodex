package com.independent.cardcodex.core_database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface DeckDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDeck(deck: DeckEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDeckCard(crossRef: DeckCardCrossRef)

    @Query("DELETE FROM deck_card_cross_ref WHERE deckId = :deckId AND cardId = :cardId")
    suspend fun removeCardFromDeck(deckId: Long, cardId: String)

    @Query("DELETE FROM decks WHERE id = :deckId")
    suspend fun deleteDeck(deckId: Long)

    @Query("SELECT * FROM decks")
    fun getAllDecks(): Flow<List<DeckEntity>>

    @Transaction
    @Query("SELECT * FROM decks WHERE id = :deckId")
    fun getDeckWithCards(deckId: Long): Flow<DeckWithCards>

    // Completeness Query
    // We calculate the number of cards we have for the deck vs total cards in deck.
    // IF collection has NULL, it means 0.
    @Query("""
        SELECT 
            d.id as deckId, 
            d.name as deckName,
            CAST(SUM(CASE WHEN IFNULL(c.quantity, 0) >= ref.quantity THEN ref.quantity ELSE IFNULL(c.quantity, 0) END) AS FLOAT) / 
            CAST(SUM(ref.quantity) AS FLOAT) * 100.0 as completenessPercent
        FROM decks d
        JOIN deck_card_cross_ref ref ON d.id = ref.deckId
        LEFT JOIN card_collection c ON ref.cardId = c.cardId
        GROUP BY d.id
    """)
    fun getDecksWithCompleteness(): Flow<List<DeckCompleteness>>
}

data class DeckCompleteness(
    val deckId: Long,
    val deckName: String,
    val completenessPercent: Float
)
