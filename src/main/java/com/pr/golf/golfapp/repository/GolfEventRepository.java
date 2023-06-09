package com.pr.golf.golfapp.repository;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import com.pr.golf.golfapp.model.GolfEvent;

@Repository
public interface GolfEventRepository extends JpaRepository<GolfEvent, Long> {

	@Query(value = "SELECT e.*  FROM golf_event e WHERE competition_id = :competitionId", nativeQuery = true)
	public List<GolfEvent> findByCompetitionId(@Param("competitionId") Long competitionId);

	@Query(value = "SELECT e.*  FROM golf_event e WHERE name = :name", nativeQuery = true)
	public Optional<GolfEvent> findByEventName(@Param("name") String name);

	@Query(value = "SELECT * FROM golf_event WHERE CASE WHEN :searchType = 'name' THEN name LIKE CONCAT('%', :searchText, '%') WHEN :searchType = 'competitionId' THEN competition_id = CAST(:searchText AS UNSIGNED) ELSE FALSE END", nativeQuery = true)
	List<GolfEvent> searchGolfEvents(@Param("searchText") String searchText, @Param("searchType") String searchType);

}
