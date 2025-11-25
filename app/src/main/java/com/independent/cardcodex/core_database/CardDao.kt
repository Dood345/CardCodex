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
}
