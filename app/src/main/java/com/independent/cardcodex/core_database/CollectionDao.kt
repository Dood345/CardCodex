package com.independent.cardcodex.core_database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface CollectionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(collection: CardCollectionEntity)

    @Query("SELECT * FROM card_collection WHERE quantity > 0")
    fun getCollection(): Flow<List<CardCollectionEntity>>

    @Query("SELECT quantity FROM card_collection WHERE cardId = :cardId")
    suspend fun getCardQuantity(cardId: String): Int?
    
    @Query("SELECT * FROM card_collection")
    fun getAllCollection(): Flow<List<CardCollectionEntity>>
}
