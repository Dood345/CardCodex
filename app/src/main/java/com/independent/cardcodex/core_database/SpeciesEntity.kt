package com.independent.cardcodex.core_database

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

@Entity(tableName = "species")
@TypeConverters(StringListConverter::class)
data class SpeciesEntity(
    @PrimaryKey val id: Int, // National Dex ID
    val name: String,
    val types: List<String>,
    val iconUrl: String
)

class StringListConverter {
    @TypeConverter
    fun fromString(value: String): List<String> {
        val listType = object : TypeToken<List<String>>() {}.type
        return Gson().fromJson(value, listType)
    }

    @TypeConverter
    fun fromList(list: List<String>): String {
        return Gson().toJson(list)
    }
}
