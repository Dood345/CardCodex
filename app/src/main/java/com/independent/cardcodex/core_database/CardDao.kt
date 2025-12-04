package com.independent.cardcodex.core_database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface CardDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSpecies(species: List<SpeciesEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCard(card: CardEntity)

    @Query("SELECT * FROM species ORDER BY id ASC")
    fun getAllSpecies(): Flow<List<SpeciesEntity>>

    @Query("SELECT * FROM cards WHERE speciesId = :speciesId")
    fun getCardsForSpecies(speciesId: Int): Flow<List<CardEntity>>
    
    @Query("SELECT * FROM cards WHERE speciesId IS NULL")
    fun getUncategorizedCards(): Flow<List<CardEntity>>

    @Query("SELECT * FROM cards WHERE cardId = :cardId")
    suspend fun getCardById(cardId: String): CardEntity?

    @Query("SELECT * FROM cards WHERE name LIKE '%' || :name || '%'")
    suspend fun getCardsByName(name: String): List<CardEntity>

    @Query("""
        SELECT DISTINCT s.* FROM species s
        JOIN cards c ON s.id = c.speciesId
        JOIN card_collection cc ON c.cardId = cc.cardId
        WHERE cc.quantity > 0
    """)
    fun getOwnedSpecies(): Flow<List<SpeciesEntity>>

    @Query("""
        SELECT c.*, IFNULL(cc.quantity, 0) as quantity 
        FROM cards c 
        LEFT JOIN card_collection cc ON c.cardId = cc.cardId 
        WHERE c.speciesId = :speciesId
    """)
    fun getCardsWithQuantityForSpecies(speciesId: Int): Flow<List<CardWithQuantity>>

    @Query("""
        SELECT c.*, IFNULL(cc.quantity, 0) as quantity 
        FROM cards c 
        LEFT JOIN card_collection cc ON c.cardId = cc.cardId 
        WHERE c.name = :name
    """)
    fun getCardsWithQuantityByName(name: String): Flow<List<CardWithQuantity>>

    @Query("""
        SELECT 
            s.*, 
            CASE WHEN EXISTS (
                SELECT 1 FROM cards c 
                JOIN card_collection cc ON c.cardId = cc.cardId 
                WHERE c.speciesId = s.id AND cc.quantity > 0
            ) THEN 1 ELSE 0 END as isOwned
        FROM species s
        ORDER BY s.id ASC
    """)
    fun getSpeciesCollectionStatus(): Flow<List<SpeciesCollectionStatus>>

    @Query("""
        SELECT 
            c.*, 
            IFNULL(cc.quantity, 0) as totalQuantity,
            MAX(0, IFNULL(cc.quantity, 0) - IFNULL((SELECT SUM(quantity) FROM deck_card_cross_ref WHERE cardId = c.cardId), 0)) as availableQuantity
        FROM cards c
        LEFT JOIN card_collection cc ON c.cardId = cc.cardId
    """)
    fun getAllCardsWithAvailability(): Flow<List<CardWithAvailability>>

    @Query("""
        SELECT 
            c.*, 
            IFNULL(cc.quantity, 0) as totalQuantity,
            MAX(0, IFNULL(cc.quantity, 0) - IFNULL((SELECT SUM(quantity) FROM deck_card_cross_ref WHERE cardId = c.cardId), 0)) as availableQuantity
        FROM cards c
        LEFT JOIN card_collection cc ON c.cardId = cc.cardId
        WHERE c.speciesId = :speciesId
    """)
    fun getCardsWithAvailabilityForSpecies(speciesId: Int): Flow<List<CardWithAvailability>>

    @Query("""
        SELECT 
            c.*, 
            IFNULL(cc.quantity, 0) as totalQuantity,
            MAX(0, IFNULL(cc.quantity, 0) - IFNULL((SELECT SUM(quantity) FROM deck_card_cross_ref WHERE cardId = c.cardId), 0)) as availableQuantity
        FROM cards c
        LEFT JOIN card_collection cc ON c.cardId = cc.cardId
        WHERE c.name = :name
    """)
    fun getCardsWithAvailabilityByName(name: String): Flow<List<CardWithAvailability>>
}
